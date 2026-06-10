import {
  LLMProvider,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
  type LLMStreamChunk,
  type LLMToolCall,
} from '@aelio/types';

/**
 * Deterministic, dependency-free LLM provider. It makes the entire agent
 * runtime exercisable with zero external services — used by default whenever
 * no real provider key is configured, and by the eval/demo harness.
 *
 * It is a small intent router: given the latest user message and the tools the
 * playbook exposes, it either (a) emits a tool call when an intent matches an
 * available tool, or (b) writes a final natural-language reply (including after
 * a tool result comes back).
 */

interface IntentRule {
  /** Tool-name fragments this intent maps to, in priority order. */
  toolHints: string[];
  /** Phrases in the user message that trigger this intent. */
  phrases: string[];
  /** Best-effort arg extraction from the raw message. */
  extractArgs?: (msg: string) => Record<string, unknown>;
}

const INTENT_RULES: IntentRule[] = [
  {
    toolHints: ['cancel_subscription', 'cancel', 'terminate', 'delete_account'],
    phrases: ['cancel', 'terminate my', 'close my account', 'end my subscription'],
  },
  {
    toolHints: ['update_plan', 'change_plan', 'downgrade', 'upgrade', 'plan'],
    phrases: ['downgrade', 'upgrade', 'change my plan', 'switch to', 'change plan'],
    extractArgs: (m) => {
      const plan = /\b(starter|basic|lite|pro|plus|premium|business|enterprise|max)\b/i.exec(m);
      return plan ? { plan: plan[1]!.toLowerCase() } : {};
    },
  },
  {
    toolHints: ['get_account_status', 'account_status', 'status', 'get_account', 'me'],
    phrases: ["what's my plan", 'my plan', 'account status', 'my account', 'how many', 'usage'],
  },
  {
    toolHints: ['schedule_report', 'schedule', 'recurring'],
    phrases: ['schedule', 'every monday', 'weekly', 'send me', 'recurring'],
  },
  {
    toolHints: ['share_resource', 'share', 'invite', 'grant_access'],
    phrases: ['share', 'give access', 'invite', 'add to'],
  },
  {
    toolHints: ['get_invoice', 'invoice', 'list_invoices', 'billing'],
    phrases: ['invoice', 'latest bill', 'receipt', 'billing'],
  },
  {
    toolHints: ['create', 'add', 'new'],
    phrases: ['create', 'make a', 'add a', 'set up'],
  },
];

const ESCALATION_PHRASES = ['speak to a human', 'talk to someone', 'agent please', 'representative'];

function lastUserText(req: LLMRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

function lastIsToolResult(req: LLMRequest): boolean {
  const last = req.messages[req.messages.length - 1];
  return !!last && last.role === 'tool';
}

function matchTool(toolNames: string[], hints: string[]): string | undefined {
  for (const hint of hints) {
    const exact = toolNames.find((n) => n === hint);
    if (exact) return exact;
  }
  for (const hint of hints) {
    const partial = toolNames.find((n) => n.includes(hint));
    if (partial) return partial;
  }
  return undefined;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `scripted_tool_${counter}`;
}

function summarizeResult(content: unknown): string {
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if ('error' in obj) return `I hit a problem: ${String(obj.error)}.`;
    const bits: string[] = [];
    for (const [k, v] of Object.entries(obj).slice(0, 4)) {
      if (v !== null && typeof v !== 'object') bits.push(`${k.replace(/_/g, ' ')}: ${String(v)}`);
    }
    if (bits.length) return bits.join(', ') + '.';
  }
  return 'Done.';
}

export class ScriptedClient implements LLMClient {
  constructor(private readonly model = 'scripted-router-v1') {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const tools = request.tools ?? [];
    const toolNames = tools.map((t) => t.name);
    const text = lastUserText(request).toLowerCase();

    // After a tool result, write a closing natural-language reply.
    if (lastIsToolResult(request)) {
      const last = request.messages[request.messages.length - 1]!;
      const results = Array.isArray(last.content) ? last.content : [];
      const summary = results.length ? summarizeResult(results[0]!.content) : 'Done.';
      return this.text(request, `All set — ${summary} Anything else I can help with?`);
    }

    if (ESCALATION_PHRASES.some((p) => text.includes(p))) {
      return this.text(
        request,
        "Of course — let me connect you with a member of the team who can help.",
      );
    }

    // Find an intent whose phrases match and whose tool is available.
    for (const rule of INTENT_RULES) {
      if (!rule.phrases.some((p) => text.includes(p))) continue;
      const tool = matchTool(toolNames, rule.toolHints);
      if (!tool) continue;
      const args = rule.extractArgs ? rule.extractArgs(text) : {};
      const toolCall: LLMToolCall = { id: nextId(), name: tool, args };
      return {
        content: '',
        toolCalls: [toolCall],
        inputTokens: this.estimate(request),
        outputTokens: 12,
        model: this.model,
        provider: LLMProvider.Scripted,
        latencyMs: 1,
      };
    }

    // No actionable intent — answer helpfully and offer the available actions.
    if (toolNames.length > 0) {
      const offer = toolNames
        .slice(0, 4)
        .map((n) => n.replace(/_/g, ' '))
        .join(', ');
      return this.text(
        request,
        `I can help with that. I can: ${offer}. What would you like to do?`,
      );
    }
    return this.text(request, "I'm here to help — could you tell me a bit more about what you need?");
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const res = await this.complete(request);
    if (res.toolCalls?.length) {
      for (const tc of res.toolCalls) {
        yield { type: 'tool_call_start', toolCall: tc };
        yield { type: 'tool_call_end', toolCall: tc };
      }
    } else {
      for (const word of res.content.split(' ')) {
        yield { type: 'text_delta', text: word + ' ' };
      }
    }
    yield {
      type: 'done',
      usage: { inputTokens: res.inputTokens, outputTokens: res.outputTokens },
    };
  }

  private text(request: LLMRequest, content: string): LLMResponse {
    return {
      content,
      inputTokens: this.estimate(request),
      outputTokens: Math.ceil(content.length / 4),
      model: this.model,
      provider: LLMProvider.Scripted,
      latencyMs: 1,
    };
  }

  private estimate(request: LLMRequest): number {
    const sys = (request.systemPrompt ?? '').length;
    const msgs = request.messages.reduce(
      (acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 64),
      0,
    );
    return Math.ceil((sys + msgs) / 4);
  }
}
