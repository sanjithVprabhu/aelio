import type { LLMClient, LLMMessage, Turn } from '@aelio/types';
import type { StateManifest, StateObjective } from '@aelio/convox-sdk';
import type { ActionDefinition } from '@aelio/types';

/** Persisted on conversation.metadata.convoxPhase */
export interface ConvoxPhaseState {
  currentState: string;
  confidence: number;
  reason?: string;
  completedObjectives: string[];
}

export const CONVOX_PHASE_METADATA_KEY = 'convoxPhase';

function turnText(turn: Turn): string {
  if (turn.content.type === 'text') return turn.content.text;
  return '';
}

function recentDialogue(history: Turn[], currentMessage: string, limit = 8): string {
  const lines = history
    .slice(-limit)
    .map((t) => `${t.role}: ${turnText(t)}`)
    .filter((l) => l.length > 2);
  lines.push(`user: ${currentMessage}`);
  return lines.join('\n');
}

function parseInferenceJson(raw: string): Partial<ConvoxPhaseState> & { newlyCompletedObjectives?: string[] } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]!) as Partial<ConvoxPhaseState> & { newlyCompletedObjectives?: string[] };
  } catch {
    return {};
  }
}

function lastUserUtterance(dialogue: string): string {
  const lines = dialogue.split('\n').filter((l) => l.startsWith('user:'));
  return (lines[lines.length - 1] ?? '').slice(5).trim().toLowerCase();
}

function scoreSignals(text: string, state: StateManifest, weight: number): number {
  const signals = (state.signals ?? state.description).toLowerCase().split(/[,;]+/);
  let score = 0;
  for (const sig of signals) {
    const s = sig.trim();
    if (s.length > 2 && text.includes(s)) score += weight;
  }
  return score;
}

/** Score states by signal overlap (scripted / fallback inference). */
function inferBySignals(
  states: StateManifest[],
  dialogue: string,
  prior?: ConvoxPhaseState,
): ConvoxPhaseState {
  const fullText = dialogue.toLowerCase();
  const latestText = lastUserUtterance(dialogue) || fullText;
  let best = prior?.currentState ?? states[0]?.key ?? 'active';
  let bestScore = 0;
  let reason = 'default';

  for (const state of states) {
    // Latest user message drives phase transitions; full dialogue retains objective hints.
    let score = scoreSignals(latestText, state, 4) + scoreSignals(fullText, state, 1);
    if (state.key === prior?.currentState) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = state.key;
      reason = score > 0 ? `matched signals for ${state.key}` : reason;
    }
  }

  const completed = new Set(prior?.completedObjectives ?? []);
  const active = states.find((s) => s.key === best);
  for (const obj of active?.objectives ?? []) {
    const hints = (obj.signals ?? obj.description).toLowerCase();
    for (const word of hints.split(/[,;\s]+/)) {
      if (word.length > 3 && fullText.includes(word)) completed.add(obj.key);
    }
  }

  return {
    currentState: best,
    confidence: bestScore > 0 ? Math.min(0.95, 0.55 + bestScore * 0.1) : 0.5,
    reason,
    completedObjectives: [...completed],
  };
}

function buildInferencePrompt(
  states: StateManifest[],
  dialogue: string,
  prior?: ConvoxPhaseState,
): string {
  const catalog = states
    .map((s) => {
      const objs =
        s.objectives?.map((o) => `    - ${o.key}: ${o.description}`).join('\n') ?? '    (none)';
      return [
        `- ${s.key}: ${s.description}`,
        `  guidance: ${s.guidance}`,
        s.signals ? `  signals: ${s.signals}` : '',
        `  objectives:\n${objs}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const priorLine = prior
    ? `Previous state: ${prior.currentState} (confidence ${prior.confidence}). Completed objectives: ${prior.completedObjectives.join(', ') || 'none'}.`
    : 'No previous state.';

  return [
    'You classify which conversation phase the user is in and track objective completion.',
    'Reply with JSON only:',
    '{"currentState":"<key>","confidence":0.0-1.0,"reason":"...","newlyCompletedObjectives":["obj_key"]}',
    '',
    'Phases:',
    catalog,
    '',
    priorLine,
    '',
    'Recent dialogue:',
    dialogue,
  ].join('\n');
}

export async function inferConvoxPhase(input: {
  llm: LLMClient;
  tenantId: string;
  conversationId: string;
  states: StateManifest[];
  history: Turn[];
  currentMessage: string;
  prior?: ConvoxPhaseState;
}): Promise<ConvoxPhaseState> {
  if (input.states.length === 0) {
    return {
      currentState: 'active',
      confidence: 1,
      completedObjectives: input.prior?.completedObjectives ?? [],
    };
  }

  const dialogue = recentDialogue(input.history, input.currentMessage);

  try {
    const resp = await input.llm.complete({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      maxTokens: 256,
      messages: [{ role: 'user', content: buildInferencePrompt(input.states, dialogue, input.prior) }],
      systemPrompt:
        'You are a phase classifier for a SaaS support agent. Output valid JSON only. Mark objectives complete only when clearly achieved in the dialogue.',
    });

    const parsed = parseInferenceJson(resp.content);
    const validKeys = new Set(input.states.map((s) => s.key));
    const hasValidState =
      typeof parsed.currentState === 'string' && validKeys.has(parsed.currentState);

    if (!hasValidState) {
      return inferBySignals(input.states, dialogue, input.prior);
    }

    const completed = new Set(input.prior?.completedObjectives ?? []);
    for (const key of parsed.newlyCompletedObjectives ?? []) {
      if (typeof key === 'string') completed.add(key);
    }

    return {
      currentState: parsed.currentState!,
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.7,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      completedObjectives: [...completed],
    };
  } catch {
    return inferBySignals(input.states, dialogue, input.prior);
  }
}

export function applyToolObjectiveCompletion(
  state: StateManifest | undefined,
  completed: string[],
  succeededTools: string[],
): string[] {
  if (!state?.objectives?.length || !succeededTools.length) return completed;
  const set = new Set(completed);
  for (const obj of state.objectives) {
    if (obj.satisfiedByTool && succeededTools.includes(obj.satisfiedByTool)) {
      set.add(obj.key);
    }
  }
  return [...set];
}

export function allObjectivesComplete(state: StateManifest | undefined, completed: string[]): boolean {
  const required = state?.objectives?.map((o) => o.key) ?? [];
  if (required.length === 0) return false;
  return required.every((k) => completed.includes(k));
}

/** Filter exposed actions to the state's optional tool allowlist. */
export function filterActionsForState(
  actions: ActionDefinition[],
  state: StateManifest | undefined,
): ActionDefinition[] {
  if (!state?.tools?.length) return actions;
  const allow = new Set(state.tools);
  return actions.filter((a) => allow.has(a.key));
}

export function buildStateGuidanceBlock(
  state: StateManifest | undefined,
  phase: ConvoxPhaseState,
): string {
  if (!state) return '';

  const lines = [
    '',
    `## Conversation phase: ${state.key}`,
    state.guidance,
  ];

  if (state.objectives?.length) {
    lines.push('', '### Guided objectives (help the user complete these in order when natural):');
    for (const obj of state.objectives) {
      const done = phase.completedObjectives.includes(obj.key);
      lines.push(`- [${done ? 'x' : ' '}] ${obj.key}: ${obj.description}`);
    }
    const remaining = state.objectives.filter((o) => !phase.completedObjectives.includes(o.key));
    if (remaining.length === 0) {
      lines.push(
        '',
        'All objectives for this phase are complete. Acknowledge completion and help with next steps within this phase or transition naturally.',
      );
    } else {
      lines.push(
        '',
        `Focus next on: ${remaining.map((o) => o.description).join('; ')}.`,
        'Guide the conversation toward these goals without being pushy.',
      );
    }
  }

  if (phase.reason) lines.push('', `Phase inference: ${phase.reason}`);
  return lines.join('\n');
}

export function readConvoxPhase(metadata: Record<string, unknown>): ConvoxPhaseState | undefined {
  const raw = metadata[CONVOX_PHASE_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.currentState !== 'string') return undefined;
  return {
    currentState: p.currentState,
    confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
    reason: typeof p.reason === 'string' ? p.reason : undefined,
    completedObjectives: Array.isArray(p.completedObjectives)
      ? p.completedObjectives.filter((x): x is string => typeof x === 'string')
      : [],
  };
}

export function writeConvoxPhase(
  metadata: Record<string, unknown>,
  phase: ConvoxPhaseState,
): Record<string, unknown> {
  return { ...metadata, [CONVOX_PHASE_METADATA_KEY]: phase };
}

export function findStateManifest(states: StateManifest[], key: string): StateManifest | undefined {
  return states.find((s) => s.key === key);
}

export function objectiveSummary(objectives: StateObjective[] | undefined): string {
  return objectives?.map((o) => o.key).join(', ') ?? '';
}

export interface ObjectiveStatus {
  key: string;
  description: string;
  completed: boolean;
}

export function buildObjectiveStatus(
  manifest: StateManifest | undefined,
  phase: ConvoxPhaseState,
): ObjectiveStatus[] {
  return (manifest?.objectives ?? []).map((o) => ({
    key: o.key,
    description: o.description,
    completed: phase.completedObjectives.includes(o.key),
  }));
}