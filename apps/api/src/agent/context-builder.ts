import type {
  ActionDefinition,
  BehaviorBundle,
  LLMMessage,
  LLMTool,
  RetrievedChunk,
  Turn,
  UserContext,
} from '@aelio/types';
import { actionToTool } from '../policy/util.js';

const MAX_HISTORY_TURNS = 12;

export interface AgentContext {
  systemPrompt: string;
  messages: LLMMessage[];
  tools: LLMTool[];
}

function buildSystemPrompt(
  behavior: BehaviorBundle,
  tenantName: string,
  userContext?: UserContext,
): string {
  const name = userContext?.displayName || 'the user';
  const plan = userContext?.plan ?? 'unknown';
  const confirmLine =
    behavior.requireConfirmationForTier <= 1
      ? 'Before taking any action that modifies data, confirm with the user first.'
      : 'You may take read actions immediately. For write actions, confirm first.';

  return [
    `You are an AI assistant for ${tenantName}.`,
    behavior.persona,
    '',
    'Tone guidelines:',
    ...behavior.toneGuidelines.map((g) => `- ${g}`),
    '',
    `The user's name is ${name}. Their plan is ${plan}.`,
    '',
    'You may only perform the actions described in the tools provided. You must not',
    'discuss, suggest, or imply actions outside of what is explicitly available. If asked',
    'to do something you cannot do, say so clearly and offer what you can do instead.',
    '',
    confirmLine,
    behavior.maxResponseLength
      ? `Keep responses under ${behavior.maxResponseLength} characters.`
      : 'Keep responses concise and focused.',
  ].join('\n');
}

function turnToMessage(turn: Turn): LLMMessage | null {
  if (turn.content.type === 'text') {
    return { role: turn.role === 'assistant' ? 'assistant' : 'user', content: turn.content.text };
  }
  return null;
}

/** Resolve the tools an action set exposes for a behavior bundle. */
export function toolsForBehavior(
  behavior: BehaviorBundle,
  exposedActions: ActionDefinition[],
): LLMTool[] {
  if (behavior.allowedActionKeys.length === 0) return [];
  const allowAll = behavior.allowedActionKeys[0] === '*';
  const allowed = allowAll
    ? exposedActions
    : exposedActions.filter((a) => behavior.allowedActionKeys.includes(a.key));
  return allowed.map(actionToTool);
}

function buildRagBlock(chunks: RetrievedChunk[]): string {
  const body = chunks
    .map((c, i) => `[${i + 1}] (${c.sourceTitle})\n${c.content}`)
    .join('\n\n');
  return `--- Reference material from the knowledge base. Use it to answer; cite naturally. ---\n${body}\n--- end reference material ---`;
}

export function buildAgentContext(input: {
  behavior: BehaviorBundle;
  tenantName: string;
  userContext?: UserContext;
  history: Turn[];
  currentMessage: string;
  tools: LLMTool[];
  kbChunks?: RetrievedChunk[];
  facts?: Array<{ key: string; value: unknown }>;
}): AgentContext {
  const systemPrompt = buildSystemPrompt(input.behavior, input.tenantName, input.userContext);
  const history = input.history
    .slice(-MAX_HISTORY_TURNS)
    .map(turnToMessage)
    .filter((m): m is LLMMessage => m !== null);

  const messages: LLMMessage[] = [...history];
  if (input.facts && input.facts.length > 0) {
    messages.push({
      role: 'user',
      content:
        'Known facts about this user: ' +
        input.facts.map((f) => `${f.key}=${String(f.value)}`).join('; '),
    });
  }
  if (input.kbChunks && input.kbChunks.length > 0) {
    messages.push({ role: 'user', content: buildRagBlock(input.kbChunks) });
  }
  messages.push({ role: 'user', content: input.currentMessage });

  return { systemPrompt, messages, tools: input.tools };
}
