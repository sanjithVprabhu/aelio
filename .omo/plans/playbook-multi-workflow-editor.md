# Playbook Editor Redesign — Multi-Workflow Visual Editor

## TL;DR
> **Summary**: Refactor the playbook editor from a single-flow-per-state model to multiple workflows per state, where each workflow is a Trigger → Action(s) → Fallback chain built via React Flow drag-and-drop. Add a playbook list page for version browsing. Workflows become the canonical source, replacing the separate triggers + allowedActions model.
> **Deliverables**: Playbook list page at `/playbooks`, refactored Builder at `/playbooks/[id]` with multi-workflow canvas, enhanced fallback error handling, updated routing
> **Effort**: Medium
> **Parallel**: YES — 2 waves
> **Critical Path**: Task 1 → Task 4 → Task 5 → Task 6 → Task 9

## Context
### Original Request
The playbooks page is broken. Each playbook state should support multiple workflows (not one monolithic flow). A workflow = Trigger node → Action node(s) → Fallback node chain built via React Flow drag-and-drop. Fallbacks handle specific error scenarios: auth errors, spelling mistakes, misunderstood messages, general failures. Need a playbook list page before entering the editor.

### Interview Summary
- **Workflow model**: Multiple sequential actions per workflow (Trigger → Action₁ → Action₂ → ... → Fallback)
- **Fallback scope**: Per-workflow fallback (each workflow has its own fallback handling)
- **List page**: Yes, add a playbook list page before editor
- **Save model**: Replace — workflows become the source of truth (replaces existing triggers + allowedActions)
- **Tech**: React Flow (@xyflow/react v12.3.5), Next.js 15 App Router

### Architecture Decisions
1. **Storage**: Workflows stored in the existing `behavior.flow` field on each state. Multiple workflows concatenated into a single `StateFlow { nodes, edges }` with `workflowId` tags on node data for reconstitution.
2. **Save mapping**: On save, workflows generate:
   - `triggers`: One PlaybookTrigger per workflow trigger node (event + condition → action)
   - `allowedActionKeys`: Aggregated from all action nodes across all workflows in the state
   - `fallbackLadder`: Deduped fallback nodes from all workflows, escalate always last
3. **Backend**: No structural changes needed. Save endpoint (`PUT /api/v1/t/:slug/playbooks/:id`) already accepts `lifecycle`, `triggers`, `fallbackLadder`.
4. **Canvas UX**: All workflows for a state shown on one canvas as disconnected subgraphs. Each workflow starts from a trigger node (visually distinct root).

## Work Objectives
### Core Objective
Users can create multiple independent workflows per playbook state. Each workflow defines a trigger condition, a chain of tool actions, and fallback handling — all composed visually with React Flow.

### Deliverables
1. Playbook list page at `/playbooks` showing all versions with status/actions
2. Refactored Builder at `/playbooks/[id]` with multi-workflow-per-state canvas
3. Workflow CRUD (create, rename, delete) within each state
4. Enhanced fallback node with error-type selection
5. Updated save logic mapping workflows → triggers + allowedActions + fallbackLadder
6. Fixed navigation (Rail links, routing)

### Definition of Done
- [ ] `/playbooks` renders a list of all playbook versions from `GET /api/v1/t/acme/playbooks`
- [ ] Clicking a playbook navigates to `/playbooks/[id]` and loads the editor
- [ ] Each state can have 0+ workflows; each workflow has ≥1 trigger node + ≥0 action nodes + ≥0 fallback nodes
- [ ] Adding a trigger, action, or fallback node to a workflow creates a connected edge automatically (or via drag)
- [ ] Deleting a workflow removes all its nodes and edges
- [ ] Save persists all workflows to the API; reload reconstitutes them correctly
- [ ] Fallback node form shows error-type options: typo/spelling, auth error, misunderstood, general
- [ ] `turbo build` on `@aelio/admin` passes with zero errors
- [ ] All existing functionality preserved: prompt preview, live chat test, publish modal

### Must Have
- Multiple workflows per state
- Workflow = trigger → action chain → fallback (React Flow nodes + edges)
- Playbook list page
- Per-workflow fallback with error type selection
- Workflows replace triggers + allowedActions at save time

### Must NOT Have
- Backend/runtime changes (triggers still fire single actions; multi-action chains remain LLM-tool-loop territory)
- New API endpoints (uses existing playbook CRUD endpoints)
- Multiple canvases or tabs per state (all workflows on ONE canvas)
- Workflow-level publish/deploy (publish remains at the playbook level)
- Real-time collaboration

## Verification Strategy
> All verification is agent-executed.
- Test decision: tests-after with vitest (existing framework)
- QA policy: Agent-executed Playwright scenarios for UI, Bash for build verification
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.png` for visual verification

## Execution Strategy
### Parallel Execution Waves

**Wave 1** (foundation): Types, list page, routing — all 3 can run in parallel
**Wave 2** (core refactor): Builder data model, canvas, save logic — sequential within wave, all depend on Wave 1
**Wave 3** (polish): Fallback enhancement, QA — depends on Wave 2

### Dependency Matrix

| Task | Can Parallel | Wave | Blocks | Blocked By |
|------|-------------|------|--------|------------|
| 1. Update Types | YES | 1 | Task 4 | — |
| 2. Playbook List Page | YES | 1 | — | — |
| 3. Navigation & Routing | YES | 1 | Task 5 | — |
| 4. Refactor Data Model | NO | 2 | Task 5,6,7 | Task 1 |
| 5. Multi-Workflow Canvas | NO | 2 | Task 7,8 | Task 3,4 |
| 6. Save Logic Refactor | NO | 2 | — | Task 4 |
| 7. Right Panel Refactor | NO | 2 | — | Task 4,5 |
| 8. Fallback Enhancement | NO | 3 | — | Task 5,7 |
| 9. QA & Build Verification | NO | 3 | — | Task 1-8 |

### Agent Dispatch Summary
| Wave | Task Count | Categories |
|------|-----------|------------|
| 1 | 3 | unspecified-high, visual-engineering |
| 2 | 4 | visual-engineering, unspecified-high |
| 3 | 2 | unspecified-high |

## TODOs

- [x] 1. Update Type Definitions for Multi-Workflow Model

  **What to do**: Update `apps/admin/app/lib/types.ts` to add the `Workflow` type and update `PlaybookState` to support an array of workflows. Add `WorkflowData` interface for node data tagging.

  **Must NOT do**: Do NOT modify `packages/types/src/playbook.ts` (backend types). The workflow model is frontend-only; mapping to backend types happens at save time. Do NOT remove existing types that other pages depend on.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: Single file, simple type additions
  - Skills: `[]` — No special skills needed
  - Omitted: `@xyflow/react` types already imported

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Task 4 | Blocked By: —

  **References**:
  - Pattern: `apps/admin/app/lib/types.ts:1-112` — Existing types to extend (PlaybookState, StoredFlow, Playbook, Action)
  - Reference: `apps/admin/app/lib/types.ts:7-19` — Current PlaybookState shape
  - Reference: `apps/admin/app/lib/types.ts:1-5` — StoredFlow (becomes Workflow)

  **Acceptance Criteria**:
  - [ ] `Workflow` type exists with: `{ id: string; label: string; nodes: Node[]; edges: Edge[] }`
  - [ ] `PlaybookState.workflows?: Workflow[]` added (optional, backward compat)
  - [ ] `PlaybookState.flow` kept as deprecated alias for backward compat
  - [ ] `Playbook.triggers` kept on type (needed by existing pages)
  - [ ] `tsc --noEmit` in `apps/admin` passes with zero errors

  **QA Scenarios**:
  ```
  Scenario: Type imports work across all files
    Tool: Bash
    Steps: cd apps/admin && npx tsc --noEmit
    Expected: Exit code 0, no type errors
    Evidence: .sisyphus/evidence/task-1-types-check.txt
  ```

  **Commit**: YES | Message: `feat(admin): add Workflow type for multi-workflow model` | Files: `apps/admin/app/lib/types.ts`

- [x] 2. Create Playbook List Page

  **What to do**: Create `/playbooks/page.tsx` — a new route that fetches all playbooks via `api('/playbooks')` and renders them as a list. Each row shows: version, status (color-coded badge), state count, deployment mode, created date. Clicking a row navigates to `/playbooks/[id]`. Include a "New Draft" button that clones the active playbook via `POST /api/v1/t/:slug/playbooks`.

  **Must NOT do**: Do NOT load the Builder/editor on this page. Do NOT modify the specs page or any other route. Do NOT implement publish from this page (publish stays in the editor modal).

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: New page with styled list UI
  - Skills: `[]` — Uses existing patterns from `data.tsx` and `ui.tsx`

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: — | Blocked By: —

  **References**:
  - Pattern: `apps/admin/app/specs/page.tsx` — Same AppShell + PageBody + PageHead pattern
  - Pattern: `apps/admin/app/components/data.tsx:45-56` — PageBody, PageHead components
  - Pattern: `apps/admin/app/components/data.tsx:89-95` — TableWrap for list
  - API: `GET /api/v1/t/acme/playbooks` returns `[{ id, version, status, deploymentMode, states, publishedAt }]`
  - API: `POST /api/v1/t/acme/playbooks` creates new draft (body: `{ version?: string }`), returns `{ id, version, status }`
  - Style: `apps/admin/app/components/ui.tsx:14-36` — Card component
  - Style: `apps/admin/app/components/ui.tsx:164-183` — TierBadge pattern for status badges
  - Icons: `apps/admin/app/lib/icons.tsx:43-49` — I.flow for playbook icon
  - API helper: `apps/admin/app/lib/api.ts:68-70` — tenant-scoped api() function

  **Acceptance Criteria**:
  - [ ] Page loads at `/playbooks` and renders inside AppShell with title "Playbooks"
  - [ ] Fetches from `api('/playbooks')` and displays all playbook versions
  - [ ] Each row shows: version, status badge (draft=gray, active=green, shadow=blue, gradual=amber, archived=red), state count, deployment mode, published date
  - [ ] Clicking a row navigates to `/playbooks/[id]`
  - [ ] "New Draft" button creates a new draft and adds it to the list
  - [ ] Loading state shows spinner, error state shows retry button, empty state shows message

  **QA Scenarios**:
  ```
  Scenario: Playbook list loads and displays entries
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:3001/playbooks
      2. Wait for API response (spinner disappears)
      3. Verify at least one playbook row is visible
      4. Verify active badge is green
      5. Click the "New Draft" button
      6. Verify a new draft row appears in the list
    Expected: List renders with playbook entries. New draft appears after button click.
    Evidence: .sisyphus/evidence/task-2-list-page.png

  Scenario: Navigation to editor on row click
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:3001/playbooks
      2. Wait for list to load
      3. Click the first playbook row
    Expected: Browser navigates to /playbooks/[id] and Builder loads
    Evidence: .sisyphus/evidence/task-2-navigation.png
  ```

  **Commit**: YES | Message: `feat(admin): add playbook list page at /playbooks` | Files: `apps/admin/app/playbooks/page.tsx`

- [x] 3. Update Navigation and Routing

  **What to do**: Fix the Rail navigation so "Playbooks" links to `/playbooks` (not `/`). Create the `/playbooks/[id]` route that renders the Builder component. Update `page.tsx` to be the dashboard page (or a redirect).

  **Must NOT do**: Do NOT change other nav items. Do NOT break the existing dashboard page at `/`. Do NOT remove the Builder component's standalone export (it's still used as a default).

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: Simple routing changes across 3 files
  - Skills: `[]` — No special skills

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Task 5 | Blocked By: —

  **References**:
  - Navigation: `apps/admin/app/components/Rail.tsx:23-28` — BUILD section with Playbooks link
  - Current: `apps/admin/app/page.tsx:1-5` — Currently renders Builder directly
  - Builder: `apps/admin/app/components/Builder.tsx:98` — Default export, self-contained component
  - Next.js App Router: dynamic route `[id]` pattern

  **Acceptance Criteria**:
  - [ ] Rail "Playbooks" nav item `href` changed from `/` to `/playbooks`
  - [ ] `/playbooks/[id]/page.tsx` created, renders `<Builder />` (or imports and passes playbookId)
  - [ ] `page.tsx` (root `/`) updated to a simple dashboard redirect or summary view
  - [ ] All existing routes (`/specs`, `/inbox`, `/knowledge`, etc.) still work
  - [ ] `active` detection in Rail highlights "Playbooks" when on `/playbooks` or `/playbooks/[id]`

  **QA Scenarios**:
  ```
  Scenario: Navigation flows work correctly
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:3001/
      2. Click "Playbooks" in the left rail
      3. Verify URL is /playbooks
      4. Click a playbook row
      5. Verify URL is /playbooks/[id] and Builder loads
    Expected: Rail link goes to /playbooks, clicking row opens editor
    Evidence: .sisyphus/evidence/task-3-routing.png

  Scenario: All other nav items still work
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:3001/
      2. Click each nav item (Specs, Inbox, Knowledge, Channels, Users, Audit, Settings)
      3. Verify each page loads without error
    Expected: All pages render correctly
    Evidence: .sisyphus/evidence/task-3-other-routes.png
  ```

  **Commit**: YES | Message: `fix(admin): route Playbooks to /playbooks, add [id] route for editor` | Files: `apps/admin/app/components/Rail.tsx`, `apps/admin/app/page.tsx`, `apps/admin/app/playbooks/[id]/page.tsx`

- [x] 4. Refactor Builder Data Model — Single Flow → Multiple Workflows

  **What to do**: Replace the `flows: Record<string, FlowGraph>` state with `workflows: Record<string, Workflow[]>`. Update the initialization logic in the `useEffect` to migrate existing flow data AND existing triggers into workflows. Each workflow gets an auto-generated `id` and `label`. Update the `migrate()` function to produce a `Workflow[]` instead of a single `FlowGraph`. Update all internal references from `flows[selStateKey]` to `workflows[selStateKey]`.

  **CRITICAL — Trigger to workflow migration**: When loading a playbook that has existing `triggers` (e.g. from bootstrap.ts) but no `flow` data, each trigger MUST be converted into a workflow:
  - Trigger node: populated from the trigger's `event` + `condition` fields, label from trigger's `label`
  - Action node: one action node created representing the trigger's `action` (transition_state, escalate_to_human, invoke_action, etc.)
  - These auto-generated workflows appear in the "Default triggers" workflow group
  - On first save, these become the source of truth (replacing pb.triggers)

  **Must NOT do**: Do NOT change the save logic yet (Task 6). Do NOT change the canvas rendering yet (Task 5). This task is purely data model + initialization. Do NOT break backward compat with existing saved flows. Do NOT lose existing trigger data — they MUST be migrated to workflows.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Core data refactor touching 20+ references across the component
  - Skills: `[]` — No special skills

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 5,6,7 | Blocked By: Task 1

  **References**:
  - Current state: `apps/admin/app/components/Builder.tsx:102` — `flows` state declaration
  - Initialization: `apps/admin/app/components/Builder.tsx:115-126` — useEffect that builds flows
  - Migration: `apps/admin/app/components/Builder.tsx:70-95` — migrate() function
  - Canvas connection: `apps/admin/app/components/Builder.tsx:128-129` — `cur = flows[selStateKey]`
  - Node mutations: `apps/admin/app/components/Builder.tsx:137-155` — onNodesChange, onEdgesChange, addNode, etc.
  - State CRUD: `apps/admin/app/components/Builder.tsx:157-173` — addState, deleteState

  **Acceptance Criteria**:
  - [ ] `flows` replaced with `workflows: Record<string, Workflow[]>` throughout Builder
  - [ ] useEffect initializes `workflows` from existing `state.flow` data (backward compat)
  - [ ] Existing single-flow playbooks migrate: one workflow created per state with the existing nodes
  - [ ] **Existing triggers (from bootstrap) are migrated to workflows**: each trigger → workflow with trigger node + action node
  - [ ] `addState()` creates an empty workflows array for the new state
  - [ ] `deleteState()` removes the state's workflows entry
  - [ ] All node CRUD functions reference `workflows[selStateKey]` correctly
  - [ ] `tsc --noEmit` in `apps/admin` passes

  **QA Scenarios**:
  ```
  Scenario: Builder loads with existing playbook and migrates to workflows
    Tool: Bash
    Steps:
      1. Start API: pnpm --filter @aelio/api dev &
      2. Start admin: pnpm --filter @aelio/admin dev &
      3. Use curl: curl http://localhost:3000/api/v1/t/acme/playbook | jq '.states[0].flow'
      4. Navigate to /playbooks and click active playbook
      5. Verify canvas shows the migrated workflows
    Expected: Builder loads without errors, existing flows appear as workflows
    Evidence: .sisyphus/evidence/task-4-migration.png
  ```

  **Commit**: YES | Message: `refactor(admin): migrate Builder data model from single flow to workflows[]` | Files: `apps/admin/app/components/Builder.tsx`

- [x] 5. Multi-Workflow Canvas — Render and Edit Multiple Workflows Per State

  **What to do**: Update the React Flow canvas to render all workflows for the selected state. Each workflow appears as a disconnected subgraph on the canvas. Add workflow management UI: "New Workflow" button in the toolbar, workflow label editing, workflow deletion. When adding a node, it should be associated with the selected/active workflow. Nodes should visually indicate which workflow they belong to (colored border or subtle background tint per workflow). Use a workflow selector (dropdown or list) above the canvas toolbar showing all workflows for the current state.

  **Must NOT do**: Do NOT render each workflow on a separate canvas or tab. Do NOT change the node types or their appearance (TriggerNode, ActionNode, FallbackNode stay the same). Do NOT change the save logic.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: Canvas UX with React Flow, workflow management UI
  - Skills: `[]` — Uses existing @xyflow/react patterns

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 7,8 | Blocked By: Task 3,4

  **References**:
  - Canvas: `apps/admin/app/components/Builder.tsx:246-267` — Current ReactFlow component
  - Toolbar: `apps/admin/app/components/Builder.tsx:247-253` — Add node buttons
  - Node types: `apps/admin/app/components/Builder.tsx:17-67` — NodeKind, KIND, custom nodes
  - State panel: `apps/admin/app/components/Builder.tsx:306-334` — StatePanel component
  - Canvas state: `apps/admin/app/components/Builder.tsx:128-129` — `cur = flows[selStateKey]`
  - Node CRUD: `apps/admin/app/components/Builder.tsx:141-155` — addNode, updateNode, deleteNode

  **Acceptance Criteria**:
  - [ ] Canvas renders ALL workflows for the selected state (concatenated nodes + edges)
  - [ ] Each workflow's nodes are visually grouped or distinguishable (e.g., different accent tint)
  - [ ] "New Workflow" button in the toolbar creates a new empty workflow with a default label
  - [ ] Workflow selector (dropdown or tab bar) above the canvas toolbar shows all workflows for the state
  - [ ] Selected/active workflow highlighted; adding nodes associates them with that workflow
  - [ ] Workflow can be renamed (inline edit on label)
  - [ ] Workflow can be deleted (with confirmation for non-empty workflows)
  - [ ] Deleting a workflow removes all its nodes and edges from the canvas
  - [ ] Adding a trigger node auto-creates a new workflow if none selected
  - [ ] Drag connections between nodes within the same workflow

  **QA Scenarios**:
  ```
  Scenario: Create multiple workflows and add nodes to each
    Tool: Playwright
    Steps:
      1. Navigate to /playbooks/[id] for the active playbook
      2. Click "New Workflow" button
      3. Verify a new workflow appears in the selector with default label
      4. With new workflow selected, click "+ trigger" in toolbar
      5. Verify a trigger node appears on canvas
      6. Click "+ action" and verify action node appears
      7. Connect trigger to action via drag
      8. Create second workflow, add a trigger + fallback
      9. Switch between workflows using selector
    Expected: Each workflow has its own nodes. Switching workflows shows correct nodes. Edges connect within workflow.
    Evidence: .sisyphus/evidence/task-5-multi-workflow.png

  Scenario: Delete workflow removes its nodes
    Tool: Playwright
    Steps:
      1. Create a workflow with 2 nodes
      2. Click delete on the workflow
      3. Confirm deletion
    Expected: Workflow removed from selector. Canvas no longer shows those nodes.
    Evidence: .sisyphus/evidence/task-5-delete-workflow.png
  ```

  **Commit**: YES | Message: `feat(admin): multi-workflow canvas with workflow CRUD` | Files: `apps/admin/app/components/Builder.tsx`

- [x] 6. Refactor Save Logic — Workflows → Triggers + AllowedActions + Fallback

  **What to do**: Rewrite the `save()` function to extract data from all workflows across all states and map them to the backend format. For each workflow: the trigger node generates a `PlaybookTrigger` (event + condition → action). Action nodes across all workflows in a state determine `allowedActionKeys`. Fallback nodes from all workflows build the `fallbackLadder`. The save payload structure remains: `{ lifecycle, triggers, fallbackLadder, version }`.

  **Must NOT do**: Do NOT change the API endpoint or the request body shape. Do NOT change how the lifecycle/behavior bundle is constructed (keep persona, tone, etc.). Do NOT remove the trigger → action mapping that already exists for transition_state and escalate_to_human triggers.

  **CRITICAL — Save guard**: If ALL states have zero workflows (no trigger nodes anywhere), the existing `pb.triggers` and `pb.fallbackLadder` MUST be preserved unchanged — do NOT send empty arrays. This prevents data loss when a user opens the editor and saves without creating any workflows.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Complex mapping logic with edge cases
  - Skills: `[]` — Pure logic, no special skills

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: — | Blocked By: Task 4

  **References**:
  - Current save: `apps/admin/app/components/Builder.tsx:177-209` — save() function
  - State mapping: `apps/admin/app/components/Builder.tsx:182-196` — states.map building lifecycle
  - Trigger dedup: `apps/admin/app/components/Builder.tsx:198-203` — fallback ladder dedup
  - API call: `apps/admin/app/components/Builder.tsx:205` — PUT /playbooks/${pb.id}
  - Backend types: `packages/types/src/playbook.ts:60-91` — PlaybookTrigger structure
  - Backend types: `packages/types/src/playbook.ts:100-105` — FallbackStep structure
  - Backend types: `packages/types/src/playbook.ts:17-29` — BehaviorBundle (allowedActionKeys)
  - Trigger action types: `packages/types/src/playbook.ts:77-82` — TriggerAction union

  **Acceptance Criteria**:
  - [ ] Each workflow's trigger node → one PlaybookTrigger in `triggers` array
  - [ ] Trigger with `event.type: 'message_received'` + condition → `invoke_action` or `transition_state` action
  - [ ] All action keys from all workflows in a state → `behavior.allowedActionKeys` (deduplicated)
  - [ ] All fallback nodes across all workflows → `fallbackLadder` (deduplicated by strategy, escalate always last)
  - [ ] If no workflows exist, state gets empty `allowedActionKeys: []` and no generated triggers
  - [ ] **Save guard**: If ALL states have zero workflow trigger nodes, preserve existing `pb.triggers` and `pb.fallbackLadder` unchanged (do NOT send empty arrays)
  - [ ] `pb.triggers` is REPLACED by workflow-generated triggers (only when workflows with triggers exist)
  - [ ] Save succeeds with HTTP 200, reload shows the same workflows reconstituted correctly

  **QA Scenarios**:
  ```
  Scenario: Save workflow data and verify it persists
    Tool: Playwright + Bash
    Steps:
      1. Navigate to /playbooks/[id]
      2. Create a workflow: trigger (message_received, phrases: "cancel"), action (cancel_subscription), fallback (rephrase)
      3. Click Save
      4. Verify toast: "Saved ✓"
      5. Reload the page
      6. Verify the workflow, nodes, and edges are all present
    Expected: Workflow data survives save/reload cycle intact
    Evidence: .sisyphus/evidence/task-6-save-persist.png

  Scenario: Save triggers via workflow
    Tool: Bash
    Steps:
      1. After saving a playbook with workflow trigger "cancel",
      2. Run: curl http://localhost:3000/api/v1/t/acme/playbook | jq '.triggers'
    Expected: triggers array contains an entry with condition.phrases containing "cancel"
    Evidence: .sisyphus/evidence/task-6-triggers.json
  ```

  **Commit**: YES | Message: `feat(admin): map workflows to triggers + allowedActions + fallback on save` | Files: `apps/admin/app/components/Builder.tsx`

- [x] 7. Refactor Right Panel — Workflow + State Editing

  **What to do**: Update the right panel (Build/Prompt/Test tabs) to handle the new workflow model. When a node is selected, show the NodeEditor (unchanged). When no node is selected, show the StateEditor AND a WorkflowManager that lists all workflows for the state with quick actions (rename, delete, reorder). The StateEditor should be updated to work with the new workflow-based model.

  **Must NOT do**: Do NOT change the Prompt or Test tabs. Do NOT change the NodeEditor component structure (TriggerForm, ActionForm, FallbackForm). Do NOT remove the state-level fields (persona, tone, etc.).

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: UI panel refactor
  - Skills: `[]` — Uses existing patterns

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 8 | Blocked By: Task 4,5

  **References**:
  - Right panel: `apps/admin/app/components/Builder.tsx:271-296` — Tab structure
  - NodeEditor: `apps/admin/app/components/Builder.tsx:342-358` — routes to TriggerForm/ActionForm/FallbackForm
  - StateEditor: `apps/admin/app/components/Builder.tsx:426-447` — state-level editing
  - State panel: `apps/admin/app/components/Builder.tsx:306-334` — left StatePanel

  **Acceptance Criteria**:
  - [ ] When no node selected, right panel shows StateEditor (persona, tone, etc.) at top
  - [ ] Below StateEditor, a WorkflowManager section shows list of workflows with: label, node count, edit/delete buttons
  - [ ] Clicking a workflow in the manager selects it (highlights on canvas, enables editing)
  - [ ] Workflow list item shows: trigger count, action count, fallback count
  - [ ] "New Workflow" button in the WorkflowManager (same as toolbar button)
  - [ ] When a node IS selected, the NodeEditor panel shows as before (unchanged UX)
  - [ ] Deselecting a node (clicking canvas) returns to StateEditor + WorkflowManager view

  **QA Scenarios**:
  ```
  Scenario: Right panel shows workflows when no node selected
    Tool: Playwright
    Steps:
      1. Navigate to /playbooks/[id] with at least one workflow
      2. Click on empty canvas (deselect any node)
      3. Verify right panel shows StateEditor + WorkflowManager
      4. Verify workflow list shows workflow labels and node counts
    Expected: Workflow list visible with correct counts
    Evidence: .sisyphus/evidence/task-7-right-panel.png

  Scenario: Clicking workflow selects it for editing
    Tool: Playwright
    Steps:
      1. In right panel WorkflowManager, click a workflow
      2. Verify the workflow is highlighted/selected
      3. Add a new node via toolbar
      4. Verify the node belongs to the selected workflow
    Expected: Workflow selection persists, new nodes go to selected workflow
    Evidence: .sisyphus/evidence/task-7-workflow-select.png
  ```

  **Commit**: YES | Message: `feat(admin): add WorkflowManager to right panel with state editor` | Files: `apps/admin/app/components/Builder.tsx`

- [x] 8. Enhance Fallback Node with Error Type Selection

  **What to do**: Update the FallbackForm component in Builder.tsx to include an "Error Type" selector that maps to fallback strategies. Add clear labels explaining what each strategy handles:
  - "Spelling / typo" → `typo_correction`
  - "Didn't understand" → `rephrase` or `slot_reprompt`
  - "Auth / permission error" → `escalate` (or new convention)
  - "General / unknown" → `offer_options` or `escalate`
  
  The selector should preset the strategy and pre-fill a helpful default message template.

  **Must NOT do**: Do NOT add new strategy types to the backend. Use existing strategies with clearer UI labels. Do NOT change the FallbackForm's core structure (strategy + maxAttempts + messageTemplate).

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: Single component enhancement
  - Skills: `[]` — No special skills

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: — | Blocked By: Task 5,7

  **References**:
  - FallbackForm: `apps/admin/app/components/Builder.tsx:414-423` — Current fallback form
  - Strategies: `apps/admin/app/components/Builder.tsx:28` — STRATEGIES constant
  - Backend ladder: `apps/api/src/playbook/fallback.ts:44-76` — Strategy handling in runtime
  - Backend types: `packages/types/src/playbook.ts:93-98` — FallbackStrategy type

  **Acceptance Criteria**:
  - [ ] FallbackForm has an "Error Type" dropdown with 4 options: Spelling/Typo, Didn't Understand, Auth/Permission Error, General/Unknown
  - [ ] Selecting an error type auto-sets the strategy and pre-fills a sensible message template
  - [ ] Spelling/Typo → strategy: `typo_correction`, message: "I think there might be a typo..."
  - [ ] Didn't Understand → strategy: `rephrase`, message: "I didn't quite catch that. Could you rephrase?"
  - [ ] Auth Error → strategy: `escalate`, message: "I'm unable to access that right now. Let me connect you with the team."
  - [ ] General → strategy: `offer_options`, message: "Here are some things I can help with."
  - [ ] Strategy and message template remain individually editable after error type selection
  - [ ] Max attempts field unchanged

  **QA Scenarios**:
  ```
  Scenario: Error type selection sets correct strategy
    Tool: Playwright
    Steps:
      1. Navigate to /playbooks/[id]
      2. Add a fallback node
      3. Click the node to open FallbackForm
      4. Select "Spelling / Typo" from error type dropdown
      5. Verify strategy field shows "typo_correction"
      6. Verify message template is pre-filled
      7. Change to "Auth / Permission Error"
      8. Verify strategy changes to "escalate"
    Expected: Error type selection correctly maps to strategy + message template
    Evidence: .sisyphus/evidence/task-8-fallback-types.png
  ```

  **Commit**: YES | Message: `feat(admin): add error type selector to fallback node editor` | Files: `apps/admin/app/components/Builder.tsx`

- [x] 9. Build Verification and QA

  **What to do**: Run `turbo build` on the admin app to verify type-safety and build integrity. Run Playwright end-to-end tests to verify the full flow: list page → editor → create workflow → add nodes → save → reload → verify persistence.

  **Must NOT do**: Do NOT make any code changes in this task. Only verification.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Build + Playwright E2E testing
  - Skills: `[]` — No special skills

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: — | Blocked By: Task 1-8

  **References**:
  - Build: `apps/admin/package.json:7` — `build` script runs `next build`
  - Test: run against local API at `http://localhost:3000` and admin at `http://localhost:3001`

  **Acceptance Criteria**:
  - [ ] `pnpm --filter @aelio/admin build` exits 0 with no errors
  - [ ] Playwright: navigate to `/playbooks`, list loads, click active playbook
  - [ ] Playwright: editor loads with canvas showing existing workflows
  - [ ] Playwright: create new workflow, add trigger + action + fallback, connect edges
  - [ ] Playwright: click Save, verify toast "Saved ✓"
  - [ ] Playwright: reload page, verify workflows persist
  - [ ] Playwright: publish flow works (modal opens, deploy succeeds)
  - [ ] Playwright: live chat test tab still works

  **QA Scenarios**:
  ```
  Scenario: Full workflow creation + save + reload cycle
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:3001/playbooks
      2. Click the active playbook
      3. Wait for editor to load
      4. Create new workflow: "Test Workflow"
      5. Add trigger node: event=message_received, condition=message_contains("test")
      6. Add action node: select "get_account_status"
      7. Connect trigger → action via drag
      8. Add fallback node: error type="Didn't Understand"
      9. Connect action → fallback
      10. Click Save
      11. Wait for "Saved ✓" toast
      12. Reload the page
      13. Verify "Test Workflow" still appears with all 3 nodes and 2 edges
    Expected: Full cycle works end-to-end without errors
    Evidence: .sisyphus/evidence/task-9-full-cycle.png
  ```

  **Commit**: NO | Message: N/A — verification only | Files: —

## Final Verification Wave
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high + playwright
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
Eight atomic commits (Tasks 1-8), each self-contained:
1. `feat(admin): add Workflow type for multi-workflow model`
2. `feat(admin): add playbook list page at /playbooks`
3. `fix(admin): route Playbooks to /playbooks, add [id] route for editor`
4. `refactor(admin): migrate Builder data model from single flow to workflows[]`
5. `feat(admin): multi-workflow canvas with workflow CRUD`
6. `feat(admin): map workflows to triggers + allowedActions + fallback on save`
7. `feat(admin): add WorkflowManager to right panel with state editor`
8. `feat(admin): add error type selector to fallback node editor`

## Success Criteria
1. `/playbooks` shows all playbook versions; clicking one opens the editor
2. Each state supports multiple workflows, each with trigger → action(s) → fallback
3. Workflows persist correctly across save/reload cycles
4. Fallback nodes let users pick error types with pre-filled strategies
5. All existing features (prompt preview, live chat test, publish modal) still work
6. `turbo build` passes with zero errors
