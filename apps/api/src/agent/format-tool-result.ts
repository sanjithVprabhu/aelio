/** Human-readable one-liner for tier-0 read tools (skips weak LLM synthesis in demos). */
export function formatToolResultForUser(toolKey: string, data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const o = data as Record<string, unknown>;

  if (toolKey === 'list_team_members' && Array.isArray(o.members)) {
    const members = o.members.map(String);
    return members.length
      ? `Your team includes: ${members.join(', ')}.`
      : 'No team members are on file yet.';
  }

  if (toolKey === 'get_account_status') {
    const parts = [
      typeof o.plan === 'string' ? `plan: ${o.plan}` : null,
      typeof o.seats === 'number' ? `seats: ${o.seats}` : null,
      typeof o.status === 'string' ? `status: ${o.status}` : null,
      typeof o.apiAccess === 'boolean' ? `API access: ${o.apiAccess ? 'on' : 'off'}` : null,
    ].filter(Boolean);
    return parts.length ? `Here's your account — ${parts.join(', ')}.` : undefined;
  }

  if (toolKey === 'get_invoice' && o.invoiceId) {
    return `Latest invoice ${String(o.invoiceId)}: $${o.amount} ${o.currency ?? 'USD'} (${o.status ?? 'unknown'}).`;
  }

  return undefined;
}