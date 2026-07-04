# Aelio Revamp Plan

This document is the end-to-end revamp plan for Aelio.

It turns the current codebase into a clean production-oriented product with
clear boundaries between:

- `Aelio Server`
- `Convox SDK`
- `Widget SDK`
- demo-only customer backends and dummy SaaS APIs

This plan is intentionally practical. It is meant to guide implementation,
cleanup, naming, testing, and rollout order.

## Goal

Build Aelio as one clean product with:

1. a server that is easy to run and reason about
2. a backend SDK that customers can wrap around their own APIs and services
3. a widget SDK that customers can embed cleanly
4. a demo environment that proves the product flow without polluting the core
   product architecture

## Product Definition

### Aelio Server

The Aelio server is the runtime brain.

It owns:

- agent harness
- LLM orchestration
- memory orchestration
- SunJet integration
- state inference
- flow progression
- policy enforcement
- identity binding
- session stitching
- tool execution decisions
- runtime registry normalization
- observability and auditability

It should feel like one deployable product.

### Convox SDK

The Convox SDK is the customer backend integration layer.

Customers install it in their backend to:

- register tools
- register states
- register flows
- register policy metadata
- sign identity assertions
- receive execute calls from Aelio
- run customer-owned backend logic

The Convox SDK is not the Aelio server.
The Convox SDK is not a demo app.
The Convox SDK is not tied to Acme or any dummy SaaS.

### Widget SDK

The widget SDK is the customer-side web client.

It owns:

- widget rendering
- chat transport
- local session persistence
- forwarding signed identity assertions to Aelio

It should remain thin.

### Demo Customer Backend

A demo customer backend exists only to prove how a customer would use the
Convox SDK in practice.

It is not part of the product surface.

It should be treated as:

- example code
- local integration harness
- smoke-test target

### Dummy SaaS APIs

Dummy SaaS APIs exist only to simulate a customer product for testing tool
execution and state/flow behavior.

They are not part of the SDK and not part of the production platform.

## Current Problems

The repo is already moving in the right direction, but several issues are still
causing confusion.

### Problem 1: Product and Demo Boundaries Are Blurry

The current repo structure makes it easy to confuse:

- product runtime code
- reusable SDK code
- demo customer backend code
- dummy SaaS behavior

The clearest example is `apps/acme-convox`, which sounds like product code even
though it is really a demo customer backend using the SDK.

### Problem 2: Naming Leaks Demo Concepts Into Product Thinking

Names like `acme-convox` make it sound like Acme is part of the product model.

It is not.

Acme is only a dummy customer used to test:

- tool registration
- tool execution
- identity binding
- state and flow behavior

### Problem 3: Setup Story Is Not Yet Clean Enough

A new user should be able to understand:

1. what to run for the Aelio server
2. what to install in their backend
3. how to embed the widget
4. what is production code versus demo code

That story is not yet clean enough.

### Problem 4: Runtime Contracts Need To Be Locked Down

The core contracts are becoming clearer, but they need to be made explicit and
enforced everywhere:

- tenant slug as public identifier
- signed identity binding
- signed execute requests
- Convox as capability publisher
- Aelio as runtime source of truth

### Problem 5: Demo UX and Production UX Still Overlap

The system still contains demo-oriented language, routes, and expectations in
places where product-safe behavior should exist.

## Revamp Principles

These principles should guide every change.

### Principle 1: One Product Center

`apps/api` is the center of the product.

Everything else either:

- extends it
- connects to it
- demonstrates it

### Principle 2: SDKs Must Be Generic

Anything inside the SDK packages must be customer-agnostic.

No Acme naming.
No dummy SaaS assumptions.
No demo-only logic in public SDK contracts.

### Principle 3: Demo Code Must Be Honest About Being Demo Code

Demo apps and mock APIs should be clearly named and isolated.

A developer reading the repo should immediately understand:

- this is product code
- this is test/demo code

### Principle 4: Contracts Before Features

Before adding more functionality, the boundaries and contracts must be clean.

Otherwise more features will only deepen the confusion.

### Principle 5: Production Path First, Demo Path Second

The demo should illustrate the real architecture, not bypass it.

That means:

- widget -> customer backend -> Aelio server -> Convox execution

not:

- widget -> hidden demo shortcuts

## Target Repo Model

The target mental model for the repo should be:

### Product Packages

- `apps/api`
  - Aelio server
- `packages/convox-sdk`
  - reusable backend SDK
- `packages/widget-sdk`
  - reusable widget SDK
- `packages/sunjet-client`
  - internal memory integration client
- `packages/memory-engine`
  - internal memory abstraction
- `packages/types`, `packages/errors`, `packages/crypto`, etc.
  - shared product packages

### Demo and Example Packages

- `apps/demo-customer-backend`
  - example customer backend using `@aelio/convox-sdk`
- `packages/demo-saas`
  - dummy SaaS data model and fake APIs for testing

### Internal Reference

- `Sunjet/`
  - internal SunJet implementation and related experiments/reference code

## Required Structural Changes

### 1. Rename Demo Backend

Completed in the current cleanup pass:

- `apps/acme-convox`

- `apps/demo-customer-backend`

This is the single most important naming fix.

Reason:

- it makes clear that this app is not the SDK
- it makes clear that this app is not part of the production Aelio surface
- it preserves the useful example without distorting the architecture

### 2. Keep Dummy SaaS Logic Out Of SDK Packages

`packages/convox-sdk` should only contain:

- generic protocols
- generic connection handling
- generic registry behavior
- generic signing helpers
- generic tests

Demo state catalogs and dummy SaaS behavior should either live in:

- `packages/demo-saas`
- demo-only fixtures
- example apps

If demo helpers remain inside the SDK package temporarily, they must be marked
as transitional and scheduled for extraction.

### 3. Separate Product Docs From Demo Docs

We should have clear docs for:

- production architecture
- SDK integration
- widget integration
- demo/local testing

These should not be mixed together in one unclear setup path.

### 4. Standardize Naming

Use these names consistently:

- `Aelio Server`
- `Convox SDK`
- `Widget SDK`
- `Demo Customer Backend`
- `Demo SaaS`
- `SunJet Memory Core`

Avoid using:

- `acme-convox` as if it were product
- `mock-saas` as if it were customer-facing product language

## Execution Plan

The revamp should happen in phases.

## Phase 0: Freeze The Product Model

Objective:

Make the architecture and repo intent explicit before more refactors happen.

Deliverables:

- architecture doc confirmed
- this revamp plan committed
- product vocabulary standardized in docs

Acceptance criteria:

- team can explain the difference between server, SDK, widget, and demo backend
- no ambiguity about whether Acme is product or demo

## Phase 1: Repo and Naming Cleanup

Objective:

Clean up the structure so the repo reflects the real architecture.

Tasks:

- rename `apps/acme-convox` to `apps/demo-customer-backend`
- update root scripts and package filters
- update references in docs and page copy
- update env var comments that mention old naming
- audit imports and logs for Acme-specific naming that should be generic

Acceptance criteria:

- a new developer cannot mistake the demo backend for the Convox SDK
- root scripts clearly distinguish product vs demo

## Phase 2: Convox SDK Hardening

Objective:

Make the backend SDK production-clean and generic.

Tasks:

- audit public API surface of `packages/convox-sdk`
- remove or isolate demo-specific exports from the public package
- ensure signed identity and signed execute flows are the default contract
- confirm registration lifecycle is deterministic and well documented
- document how customers register tools, states, flows, and policy metadata
- define compatibility guarantees for protocol messages

Acceptance criteria:

- a customer backend can install the SDK without seeing Acme-specific concepts
- public APIs are generic and documented
- the SDK can be explained independently of the demo app

## Phase 3: Aelio Server Consolidation

Objective:

Make the server feel like one coherent runtime.

Tasks:

- tighten boot/config story
- clearly separate demo routes from product routes
- confirm Aelio is the runtime source of truth for normalized registry state
- consolidate identity flow and session binding contracts
- ensure SunJet is treated as internal Aelio memory, not a separate user-facing
  product dependency
- standardize runtime health/readiness endpoints
- reduce accidental demo coupling in runtime logic

Acceptance criteria:

- the Aelio server can be started and understood as a standalone product
- demo mode is optional, not architecturally required

## Phase 4: Widget SDK Productionization

Objective:

Make the widget behave like a real customer integration surface.

Tasks:

- keep the widget UI thin and product-safe
- ensure signed identity binding is first-class
- ensure embed docs match actual recommended usage
- remove demo-only wording from end-user error states
- add clearer customer integration examples

Acceptance criteria:

- widget can be embedded in a customer site without demo assumptions
- identity token flow is documented and testable

## Phase 5: End-to-End Demo Rebuild

Objective:

Rebuild the demo so it proves the real architecture instead of obscuring it.

Tasks:

- demo customer backend uses Convox SDK exactly like a customer would
- widget obtains identity token from demo customer backend
- Aelio verifies identity and manages runtime flow
- demo SaaS handlers execute through Convox
- demo dashboards and inspectors explain the architecture honestly

Acceptance criteria:

- `/chat` or equivalent demo route shows the real product flow
- the demo is a truthful example of customer usage

## Phase 6: Testing and Validation

Objective:

Guarantee that the system is stable across contracts.

Required test layers:

- unit tests for SDK helpers
- integration tests for registry sync
- identity flow tests
- signed execute contract tests
- widget transport tests
- server + Convox + demo backend full-stack smoke tests

Minimum critical test scenarios:

1. widget session created
2. customer backend signs identity
3. Aelio binds identity
4. message enters Aelio runtime
5. state and flow are inferred
6. tool call is selected
7. execute request is signed
8. customer backend handles execute
9. result returns to Aelio
10. final response renders in widget

Acceptance criteria:

- all critical contracts have automated coverage
- demo can be used confidently in a live presentation

## Phase 7: Production Readiness

Objective:

Prepare the repo and runtime for real deployment.

Tasks:

- finalize configuration model
- document deployment topology
- document persistence requirements
- document SunJet embedding/runtime story
- harden secrets handling
- define observability baseline
- define upgrade and compatibility strategy

Acceptance criteria:

- operator can deploy Aelio with confidence
- customer can integrate Convox SDK and widget SDK with clear docs

## Contract Checklist

These are non-negotiable contracts for the revamp.

### Public Tenant Contract

- public APIs use tenant slug
- internal UUIDs remain internal

### Identity Contract

- widget session is distinct from customer user identity
- customer backend signs identity assertion
- Aelio binds identity to session

### Execute Contract

- Aelio initiates execution
- execute requests are signed
- customer backend validates context through SDK

### Registry Contract

- customer backend publishes tools/states/flows
- Aelio normalizes runtime view
- runtime executes against normalized view

### Memory Contract

- SunJet is internal to Aelio
- customers should not need to understand SunJet as a separate product just to
  use Aelio

## Deliverables

The revamp is complete when the repo contains:

1. clean product package boundaries
2. clean demo boundaries
3. generic SDKs
4. truthful demo architecture
5. production-safe docs
6. stable end-to-end tests

## Immediate Next Actions

These should happen next in order.

1. Commit this plan and align on vocabulary.
2. Finish auditing `packages/convox-sdk` for demo-specific exports and move
   them out if
   needed.
3. Re-run the customer demo path after the rename and confirm behavior is still
   intact.
4. Write the production-facing Convox SDK integration doc.
5. Write the production-facing Widget SDK integration doc.

## Success Definition

This revamp succeeds if someone new can open the repo and immediately
understand:

- what Aelio is
- what the server does
- what the Convox SDK does
- what the widget does
- what is demo-only
- how a real customer would integrate the system

That clarity is the foundation for everything else.
