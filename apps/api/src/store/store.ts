import type {
  ActionDefinition,
  ActionInvocation,
  ApiSpec,
  Channel,
  Conversation,
  EndUserIdentity,
  Escalation,
  EvalRun,
  EvalScenario,
  EvalSuite,
  IdentityChannel,
  KbChunk,
  KbCollection,
  KbSource,
  OnboardingState,
  Playbook,
  Tenant,
  Turn,
} from '@aelio/types';

export interface LongTermFact {
  id: string;
  identityId: string;
  tenantId: string;
  key: string;
  value: unknown;
  confidence: number;
  extractedAt: Date;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  conversationId?: string;
  endUserId?: string;
  adminUserId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  traceId?: string;
  createdAt: Date;
}

/**
 * In-memory repository layer. Every collection query filters on tenantId — the
 * tenant-isolation invariant is enforced here, not left to callers. Audit and
 * invocation collections are append-only (no update/delete methods exist).
 */
export class Store {
  private tenants = new Map<string, Tenant>();
  private channels = new Map<string, Channel>();
  private identities = new Map<string, EndUserIdentity>();
  private identityChannels = new Map<string, IdentityChannel>();
  private conversations = new Map<string, Conversation>();
  private turns: Turn[] = [];
  private playbooks = new Map<string, Playbook>();
  private specs = new Map<string, ApiSpec>();
  private actions = new Map<string, ActionDefinition>();
  private invocations: ActionInvocation[] = [];
  private escalations = new Map<string, Escalation>();
  private auditLog: AuditEvent[] = [];
  private onboarding = new Map<string, OnboardingState>();
  private kbCollections = new Map<string, KbCollection>();
  private kbSources = new Map<string, KbSource>();
  private kbChunks: KbChunk[] = [];
  private evalSuites = new Map<string, EvalSuite>();
  private evalScenarios = new Map<string, EvalScenario>();
  private evalRuns = new Map<string, EvalRun>();
  private longTerm: LongTermFact[] = [];

  // Optional durable mirror (Postgres). Sync reads stay in-memory; writes are
  // mirrored through fire-and-forget. Suppressed during hydration.
  private persistence?: import('./persistence.js').Persistence;
  private hydrating = false;

  setPersistence(p: import('./persistence.js').Persistence): void {
    this.persistence = p;
  }
  private save(kind: import('./persistence.js').PersistKind, row: unknown): void {
    if (!this.hydrating) this.persistence?.upsert(kind, row as Record<string, unknown>);
  }
  private remove(kind: import('./persistence.js').PersistKind, id: string): void {
    if (!this.hydrating) this.persistence?.remove(kind, id);
  }

  /** Bulk-load durable state into the working set at startup (no write-back). */
  load(s: import('./persistence.js').StoreSnapshot): void {
    this.hydrating = true;
    try {
      for (const t of (s.tenants ?? []) as Tenant[]) this.tenants.set(t.id, t);
      for (const c of (s.channels ?? []) as Channel[]) this.channels.set(c.id, c);
      for (const i of (s.identities ?? []) as EndUserIdentity[]) this.identities.set(i.id, i);
      for (const ic of (s.identity_channels ?? []) as IdentityChannel[]) this.identityChannels.set(ic.id, ic);
      for (const c of (s.conversations ?? []) as Conversation[]) this.conversations.set(c.id, c);
      this.turns.push(...((s.turns ?? []) as Turn[]));
      for (const p of (s.playbooks ?? []) as Playbook[]) this.playbooks.set(p.id, p);
      for (const sp of (s.specs ?? []) as ApiSpec[]) this.specs.set(sp.id, sp);
      for (const a of (s.actions ?? []) as ActionDefinition[]) this.actions.set(a.id, a);
      this.invocations.push(...((s.invocations ?? []) as ActionInvocation[]));
      for (const e of (s.escalations ?? []) as Escalation[]) this.escalations.set(e.id, e);
      this.auditLog.push(...((s.audit ?? []) as AuditEvent[]));
      for (const o of (s.onboarding ?? []) as OnboardingState[]) this.onboarding.set(o.tenantId, o);
      for (const col of (s.kb_collections ?? []) as KbCollection[]) this.kbCollections.set(col.id, col);
      for (const so of (s.kb_sources ?? []) as KbSource[]) this.kbSources.set(so.id, so);
      this.kbChunks.push(...((s.kb_chunks ?? []) as KbChunk[]));
      for (const su of (s.eval_suites ?? []) as EvalSuite[]) this.evalSuites.set(su.id, su);
      for (const sc of (s.eval_scenarios ?? []) as EvalScenario[]) this.evalScenarios.set(sc.id, sc);
      for (const r of (s.eval_runs ?? []) as EvalRun[]) this.evalRuns.set(r.id, r);
      this.longTerm.push(...((s.long_term ?? []) as LongTermFact[]));
    } finally {
      this.hydrating = false;
    }
  }

  /** True if any tenant already exists (used to decide whether to seed). */
  hasData(): boolean {
    return this.tenants.size > 0;
  }

  // ---- Tenants ----
  putTenant(t: Tenant): void {
    this.tenants.set(t.id, t);
    this.save("tenants", t);
  }
  getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }
  getTenantBySlug(slug: string): Tenant | undefined {
    return [...this.tenants.values()].find((t) => t.slug === slug);
  }
  listTenants(): Tenant[] {
    return [...this.tenants.values()];
  }

  // ---- Channels ----
  putChannel(c: Channel): void {
    this.channels.set(c.id, c);
    this.save("channels", c);
  }
  getChannel(tenantId: string, id: string): Channel | undefined {
    const c = this.channels.get(id);
    return c && c.tenantId === tenantId ? c : undefined;
  }
  listChannels(tenantId: string): Channel[] {
    return [...this.channels.values()].filter((c) => c.tenantId === tenantId);
  }
  findChannelByType(tenantId: string, type: string): Channel | undefined {
    return [...this.channels.values()].find((c) => c.tenantId === tenantId && c.type === type);
  }

  // ---- Identities ----
  putIdentity(i: EndUserIdentity): void {
    this.identities.set(i.id, i);
    this.save("identities", i);
  }
  getIdentity(tenantId: string, id: string): EndUserIdentity | undefined {
    const i = this.identities.get(id);
    return i && i.tenantId === tenantId ? i : undefined;
  }
  getIdentityById(id: string): EndUserIdentity | undefined {
    return this.identities.get(id);
  }
  findIdentityByExternal(tenantId: string, externalUserId: string): EndUserIdentity | undefined {
    return [...this.identities.values()].find(
      (i) => i.tenantId === tenantId && i.externalUserId === externalUserId,
    );
  }
  listIdentities(tenantId: string): EndUserIdentity[] {
    return [...this.identities.values()].filter((i) => i.tenantId === tenantId);
  }

  // ---- Identity channels ----
  putIdentityChannel(ic: IdentityChannel): void {
    this.identityChannels.set(ic.id, ic);
    this.save("identity_channels", ic);
  }
  findIdentityChannel(
    tenantId: string,
    channelType: string,
    identifier: string,
  ): IdentityChannel | undefined {
    return [...this.identityChannels.values()].find(
      (ic) =>
        ic.tenantId === tenantId && ic.channelType === channelType && ic.identifier === identifier,
    );
  }
  listIdentityChannels(identityId: string): IdentityChannel[] {
    return [...this.identityChannels.values()].filter((ic) => ic.identityId === identityId);
  }
  /** Cross-channel stitching: a trusted channel on any type sharing this identifier. */
  findTrustedChannelByIdentifier(tenantId: string, identifier: string): IdentityChannel | undefined {
    return [...this.identityChannels.values()].find(
      (ic) => ic.tenantId === tenantId && ic.identifier === identifier && ic.trusted,
    );
  }

  // ---- Conversations ----
  putConversation(c: Conversation): void {
    this.conversations.set(c.id, c);
    this.save("conversations", c);
  }
  getConversation(tenantId: string, id: string): Conversation | undefined {
    const c = this.conversations.get(id);
    return c && c.tenantId === tenantId ? c : undefined;
  }
  findActiveConversation(tenantId: string, identityId: string): Conversation | undefined {
    return [...this.conversations.values()]
      .filter(
        (c) => c.tenantId === tenantId && c.identityId === identityId && c.status !== 'resolved',
      )
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())[0];
  }
  listConversations(tenantId: string): Conversation[] {
    return [...this.conversations.values()]
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }

  // ---- Turns ----
  addTurn(t: Turn): void {
    this.turns.push(t);
    this.save("turns", t);
  }
  listTurns(tenantId: string, conversationId: string): Turn[] {
    return this.turns
      .filter((t) => t.tenantId === tenantId && t.conversationId === conversationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // ---- Playbooks ----
  putPlaybook(p: Playbook): void {
    this.playbooks.set(p.id, p);
    this.save("playbooks", p);
  }
  getPlaybook(tenantId: string, id: string): Playbook | undefined {
    const p = this.playbooks.get(id);
    return p && p.tenantId === tenantId ? p : undefined;
  }
  listPlaybooks(tenantId: string): Playbook[] {
    return [...this.playbooks.values()].filter((p) => p.tenantId === tenantId);
  }
  findActivePlaybook(tenantId: string): Playbook | undefined {
    const all = this.listPlaybooks(tenantId);
    return all.find((p) => p.status === 'active') ?? all.find((p) => p.status === 'draft');
  }

  // ---- Specs ----
  putSpec(s: ApiSpec): void {
    this.specs.set(s.id, s);
    this.save("specs", s);
  }
  getSpec(tenantId: string, id: string): ApiSpec | undefined {
    const s = this.specs.get(id);
    return s && s.tenantId === tenantId ? s : undefined;
  }
  listSpecs(tenantId: string): ApiSpec[] {
    return [...this.specs.values()].filter((s) => s.tenantId === tenantId);
  }

  // ---- Actions ----
  putAction(a: ActionDefinition): void {
    this.actions.set(a.id, a);
    this.save("actions", a);
  }
  getAction(tenantId: string, id: string): ActionDefinition | undefined {
    const a = this.actions.get(id);
    return a && a.tenantId === tenantId ? a : undefined;
  }
  getActionByKey(tenantId: string, key: string): ActionDefinition | undefined {
    return [...this.actions.values()].find((a) => a.tenantId === tenantId && a.key === key);
  }
  listActions(tenantId: string): ActionDefinition[] {
    return [...this.actions.values()].filter((a) => a.tenantId === tenantId);
  }
  listExposedActions(tenantId: string): ActionDefinition[] {
    return this.listActions(tenantId).filter((a) => a.exposed);
  }

  // ---- Invocations (append-only) ----
  addInvocation(i: ActionInvocation): void {
    this.invocations.push(i);
    this.save("invocations", i);
  }
  listInvocations(tenantId: string, conversationId?: string): ActionInvocation[] {
    return this.invocations
      .filter(
        (i) =>
          i.tenantId === tenantId && (!conversationId || i.conversationId === conversationId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ---- Escalations ----
  putEscalation(e: Escalation): void {
    this.escalations.set(e.id, e);
    this.save("escalations", e);
  }
  getEscalation(tenantId: string, id: string): Escalation | undefined {
    const e = this.escalations.get(id);
    return e && e.tenantId === tenantId ? e : undefined;
  }
  listEscalations(tenantId: string): Escalation[] {
    return [...this.escalations.values()]
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ---- Audit (append-only) ----
  addAudit(e: AuditEvent): void {
    this.auditLog.push(e);
    this.save("audit", e);
  }
  listAudit(tenantId: string, conversationId?: string): AuditEvent[] {
    return this.auditLog
      .filter(
        (e) =>
          e.tenantId === tenantId && (!conversationId || e.conversationId === conversationId),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ---- Onboarding ----
  putOnboarding(s: OnboardingState): void {
    this.onboarding.set(s.tenantId, s);
    this.save("onboarding", s);
  }
  getOnboarding(tenantId: string): OnboardingState | undefined {
    return this.onboarding.get(tenantId);
  }

  // ---- Knowledge base ----
  putCollection(col: KbCollection): void {
    this.kbCollections.set(col.id, col);
    this.save("kb_collections", col);
  }
  getCollection(tenantId: string, id: string): KbCollection | undefined {
    const c = this.kbCollections.get(id);
    return c && c.tenantId === tenantId ? c : undefined;
  }
  listCollections(tenantId: string): KbCollection[] {
    return [...this.kbCollections.values()].filter((c) => c.tenantId === tenantId);
  }
  putSource(s: KbSource): void {
    this.kbSources.set(s.id, s);
    this.save("kb_sources", s);
  }
  listSources(tenantId: string, collectionId: string): KbSource[] {
    return [...this.kbSources.values()].filter(
      (s) => s.tenantId === tenantId && s.collectionId === collectionId,
    );
  }
  deleteSource(tenantId: string, sourceId: string): void {
    const s = this.kbSources.get(sourceId);
    if (s && s.tenantId === tenantId) {
      this.kbSources.delete(sourceId);
      this.kbChunks = this.kbChunks.filter((c) => c.sourceId !== sourceId);
      this.remove('kb_sources', sourceId);
      this.remove('kb_chunks', sourceId); // id treated as sourceId for chunk deletes
    }
  }
  putChunk(chunk: KbChunk): void {
    this.kbChunks.push(chunk);
    this.save("kb_chunks", chunk);
  }
  clearChunksForSource(sourceId: string): void {
    this.kbChunks = this.kbChunks.filter((c) => c.sourceId !== sourceId);
    this.remove('kb_chunks', sourceId);
  }
  listChunks(tenantId: string, collectionIds: string[]): KbChunk[] {
    return this.kbChunks.filter(
      (c) => c.tenantId === tenantId && collectionIds.includes(c.collectionId),
    );
  }

  // ---- Eval ----
  putEvalSuite(s: EvalSuite): void {
    this.evalSuites.set(s.id, s);
    this.save("eval_suites", s);
  }
  getEvalSuite(tenantId: string, id: string): EvalSuite | undefined {
    const s = this.evalSuites.get(id);
    return s && s.tenantId === tenantId ? s : undefined;
  }
  listEvalSuites(tenantId: string): EvalSuite[] {
    return [...this.evalSuites.values()].filter((s) => s.tenantId === tenantId);
  }
  putEvalScenario(s: EvalScenario): void {
    this.evalScenarios.set(s.id, s);
    this.save("eval_scenarios", s);
  }
  listEvalScenarios(tenantId: string, suiteId: string): EvalScenario[] {
    return [...this.evalScenarios.values()].filter(
      (s) => s.tenantId === tenantId && s.suiteId === suiteId,
    );
  }
  putEvalRun(r: EvalRun): void {
    this.evalRuns.set(r.id, r);
    this.save("eval_runs", r);
  }
  getEvalRun(tenantId: string, id: string): EvalRun | undefined {
    const r = this.evalRuns.get(id);
    return r && r.tenantId === tenantId ? r : undefined;
  }

  // ---- Long-term memory ----
  putFact(f: LongTermFact): void {
    const idx = this.longTerm.findIndex(
      (x) => x.identityId === f.identityId && x.key === f.key,
    );
    if (idx >= 0) this.longTerm[idx] = f;
    else this.longTerm.push(f);
    this.save('long_term', f);
  }
  listFacts(tenantId: string, identityId: string): LongTermFact[] {
    return this.longTerm.filter((f) => f.tenantId === tenantId && f.identityId === identityId);
  }

  // ---- GDPR erasure ----
  eraseIdentity(tenantId: string, identityId: string): void {
    const identity = this.identities.get(identityId);
    if (!identity || identity.tenantId !== tenantId) return;
    this.identities.delete(identityId);
    for (const [id, ic] of this.identityChannels) if (ic.identityId === identityId) this.identityChannels.delete(id);
    for (const [id, conv] of this.conversations) if (conv.identityId === identityId) this.conversations.delete(id);
    this.turns = this.turns.filter((t) => {
      const conv = [...this.conversations.values()].find((cv) => cv.id === t.conversationId);
      return conv !== undefined;
    });
    this.longTerm = this.longTerm.filter((f) => f.identityId !== identityId);
    // Audit + invocations are append-only and retain a hashed reference only.
    if (!this.hydrating) this.persistence?.eraseIdentity?.(tenantId, identityId);
  }
}
