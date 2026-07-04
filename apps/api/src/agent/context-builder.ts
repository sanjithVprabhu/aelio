import type { ActionDefinition, LLMMessage, LLMTool, Turn, UserContext } from '@aelio/types';
import { actionToTool } from '../policy/util.js';

const MAX_HISTORY_TURNS = 12;

export interface AgentContext {
  systemPrompt: string;
  messages: LLMMessage[];
  tools: LLMTool[];
}

function buildSystemPrompt(tenantName: string, userContext?: UserContext): string {
  const name = userContext?.displayName || 'the user';
  const plan = userContext?.plan ?? 'unknown';

  return [
    `You are an AI assistant for ${tenantName}.`,
    `The user's name is ${name}. Their plan is ${plan}.`,
    '',
    'You may only perform the actions described in the tools provided. You must not',
    'discuss, suggest, or imply actions outside of what is explicitly available.',
    '',
    'When the user asks for information or an action that matches a tool, CALL THAT TOOL',
    'immediately. Never reply by only listing tool names or asking what they want — execute',
    'the matching tool first, then summarize the result.',
    '',
    'Before taking any action that modifies data, confirm with the user first when required.',
    'Keep responses concise and focused.',
  ].join('\n');
}

function turnToMessage(turn: Turn): LLMMessage | null {
  if (turn.content.type === 'text') {
    return { role: turn.role === 'assistant' ? 'assistant' : 'user', content: turn.content.text };
  }
  return null;
}

/** All exposed Convox-backed tools available to the agent for this turn. */
export function toolsFromActions(exposedActions: ActionDefinition[]): LLMTool[] {
  return exposedActions.map(actionToTool);
}

export function buildAgentContext(input: {
  tenantName: string;
  userContext?: UserContext;
  history: Turn[];
  currentMessage: string;
  tools: LLMTool[];
  facts?: Array<{ key: string; value: unknown }>;
  /** Convox phase guidance + objective checklist appended to the system prompt. */
  stateGuidanceBlock?: string;
  /** Single active conversational intent (slot-filling boundary). */
  intentGuidanceBlock?: string;
}): AgentContext {
  let systemPrompt = buildSystemPrompt(input.tenantName, input.userContext);
  if (input.stateGuidanceBlock?.trim()) {
    systemPrompt += input.stateGuidanceBlock;
  }
  if (input.intentGuidanceBlock?.trim()) {
    systemPrompt += input.intentGuidanceBlock;
  }
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
  messages.push({ role: 'user', content: input.currentMessage });

  return { systemPrompt, messages, tools: input.tools };
}