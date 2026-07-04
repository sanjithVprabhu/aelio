# Aelio V1 Architecture

This document defines the target production architecture for Aelio v1.

It is intentionally opinionated. The goal is to give the repo one clear
direction for cleanup, implementation, and production hardening.

## Purpose

Aelio is one product with three public surfaces:

1. `Aelio Server`
2. `Convox SDK`
3. `Widget SDK`

The server is the center of the system. The SDKs exist to connect customers
and end users to the server cleanly.

This document defines:

- what each part is
- what each part is not
- the contracts between them
- the setup model
- the phased execution plan to reach production readiness

## Product Model

### Aelio Server

`Aelio Server` is the single runtime product.

It owns:

- agent harness and orchestration
- LLM interaction
- state inference
- flow progression
- policy and safety enforcement
- live tool/state/flow registry
- identity binding and session stitching
- memory lifecycle
- Convox connection management
- customer-facing and operator-facing APIs

It is the runtime brain of the system.

### SunJet Memory Core

`SunJet` is the built-in memory subsystem of Aelio.

It is implemented in Rust, but for product and deployment purposes it is part
of `Aelio Server`, not a separate product concept.

It owns:

- turn memory
- episodic memory
- retrieval
- compaction
- layered memory rollups
- `.vss`-backed storage/runtime concerns

Implementation note:

- In early versions, SunJet may still run as a separate process or daemon.
- In product terms, it is still part of the Aelio runtime.
- Customers should think of this as "Aelio memory", not as a separate system
  they need to assemble themselves.

### Convox SDK

`Convox SDK` is the customer backend integration layer.

Customers install it in their backend to:

- register tools
- register states
- register flows
- register policy overrides
- bind logged-in end users to widget sessions
- receive execute requests from Aelio
- run real backend logic inside their own environment

Convox is not the brain. It is the capability bridge between Aelio and the
customer's backend.

### Widget SDK

`Widget SDK` is the customer-facing embedded chat client.

It owns:

- chat UI rendering
- widget session management
- identity assertion forwarding
- transport to Aelio Server

It does not own:

- business logic
- tool selection
- memory
- policy
- state inference

It should stay thin.

## Runtime Topology

The target topology is:

1. End user interacts with `Widget SDK`
2. Widget sends messages to `Aelio Server`
3. Aelio runtime resolves identity, memory, state, flow, and policy
4. Aelio runtime uses LLMs to decide what to do
5. If a tool is needed, Aelio calls the connected `Convox SDK`
6. Convox executes customer backend logic
7. Result returns to Aelio
8. Aelio synthesizes the final conversational response
9. Widget renders the response

Memory is handled inside the Aelio runtime through the SunJet memory core.

## Ownership Boundaries

### Aelio Server Owns

- runtime harness
- policy engine
- step-up and confirmation flow
- memory orchestration
- retrieval orchestration
- canonical runtime registry view
- session and identity binding
- tool invocation decisions
- observability
- operational lifecycle

### Convox SDK Owns

- customer-declared tool definitions
- customer-declared state definitions
- customer-declared flow definitions
- customer-declared policy hints or overrides
- customer-side execution handlers
- customer-side identity assertion signing

### Widget SDK Owns

- presentation
- local session persistence
- transport to server
- UI state for conversation rendering

## Source of Truth

There are two kinds of source of truth in the system.

### Customer Capability Source of Truth

The customer backend is the source of truth for:

- tools
- states
- flows
- customer policy overrides

These are published to Aelio over the Convox connection.

### Runtime Source of Truth

The Aelio server is the source of truth for:

- currently active registry for execution
- policy-resolved action catalog
- active state and flow progression
- session binding state
- memory and retrieval state
- audit trail

The server ingests customer capability definitions, normalizes them, stores the
runtime view, and executes against that view.

## Canonical Contracts

These contracts must be stable across the system.

### Tenant Identity Contract

External/customer-facing APIs should use the tenant slug.

Internal persistence may use an internal tenant UUID.

Rule:

- slug is the public identifier
- UUID is the internal storage identifier
- public SDKs and browser flows must not depend on internal tenant UUIDs

### Identity Binding Contract

The target identity flow is:

1. Widget creates or resumes a widget session
2. Customer backend authenticates the user in its own system
3. Customer backend uses Convox SDK to sign an identity assertion
4. Widget sends the assertion to Aelio Server
5. Aelio binds the widget session to the external user identity
6. Aelio uses the bound identity in runtime and tool execution

Rule:

- widget sessions are not the same as customer user identities
- the signed assertion is the bridge between them

### Tool Execution Contract

Tool execution must be:

- initiated by Aelio Server
- executed by customer backend through Convox
- bound to a verified tenant and user context
- auditable
- policy-aware

Rule:

- execute requests must be signed
- unsigned execute requests are not valid in production
- tool args must be validated before handler execution

### Registry Contract

The server maintains a live registry of:

- tools
- states
- flows
- policy metadata

Rule:

- Convox publishes
- Aelio normalizes and persists runtime view
- runtime consumes the normalized view

## Setup Model

The setup experience must feel like one product.

### Aelio Server Setup

An operator should be able to:

1. install Aelio
2. start Aelio
3. know that memory is included
4. know the runtime surface is ready

They should not need to mentally compose:

- one server
- one memory product
- one side daemon
- one separate registry system

If SunJet runs as a subprocess or internal daemon, Aelio should own that
lifecycle.

### Convox Customer Setup

A customer should be able to:

1. install `@aelio/convox-sdk`
2. configure server URL + API key + tenant slug
3. register tools, states, flows, and policy overrides
4. start their backend
5. see those definitions reflected in Aelio

### Widget Setup

A customer should be able to:

1. install or embed `@aelio/widget-sdk`
2. point it at the Aelio server
3. optionally connect identity binding
4. embed it on their site

## Required Characteristics For Production

### Aelio Server

- single clear boot path
- simple environment model
- no demo-only assumptions in primary product routes
- genuine typecheck/test/build health
- deterministic registry behavior
- deterministic identity binding behavior
- deterministic memory lifecycle behavior

### Convox SDK

- stable connection lifecycle
- clear readiness semantics
- reliable reconnect and resync
- secure execute contract
- validated tool args
- clear DX for registration and updates

### Widget SDK

- clean embed experience
- stable API contract
- proper auth/identity path
- production-safe error handling
- no localhost/demo assumptions in UX copy

## Current Gaps To Close

The current repo diverges from this target in several ways:

- Aelio Server is carrying demo and product concerns in the same surface
- SunJet is still treated as optional/external in setup and boot flow
- tenant identity handling is inconsistent across server and SDK layers
- Convox readiness and execute security are not strict enough
- widget identity binding is not fully wired through the public flow
- docs overstate current system readiness
- typecheck is not fully green

These are first-order cleanup items, not polish items.

## Execution Plan

Work should happen in this order.

### Phase 1: Aelio Server Foundation

Goal:

- make Aelio Server the one clean runtime product

Tasks:

- define and enforce the public/internal tenant identity contract
- simplify the environment and boot model
- make SunJet lifecycle part of Aelio lifecycle
- separate demo routes from product routes
- define canonical runtime registry behavior
- fix current server typecheck failures
- align docs with reality

Acceptance criteria:

- Aelio boots with one clear path
- product routes are distinct from demo harnesses
- runtime registry behavior is documented and deterministic
- typecheck passes

### Phase 2: Convox SDK Hardening

Goal:

- make Convox a production-safe customer integration SDK

Tasks:

- define readiness semantics for connect/register
- require signed execute flow in production
- add runtime arg validation
- normalize tenant slug usage across SDK contracts
- make sync/update/remove behavior deterministic
- improve customer-facing setup and examples

Acceptance criteria:

- customer can register tools/states/flows/policies reliably
- server reflects updates reliably
- execute flow is signed and validated
- SDK behavior matches docs

### Phase 3: Widget SDK Cleanup

Goal:

- make widget integration easy and production-safe

Tasks:

- add or finalize the identity assertion flow
- remove demo-specific error copy and assumptions
- stabilize response contract with server
- simplify install and embed docs
- ensure clean rendering behavior and UI state

Acceptance criteria:

- widget embed works with clean server defaults
- identity binding path is documented and functional
- no demo-specific UX appears in production paths

### Phase 4: Production Hardening

Goal:

- make the full system deployable with confidence

Tasks:

- add cross-layer smoke tests
- add startup diagnostics
- add contract tests for registry and identity flows
- add deployment and rollback docs
- add observability and failure-mode documentation

Acceptance criteria:

- end-to-end smoke tests pass
- setup documentation is accurate
- production lifecycle is documented

## Immediate Next Actions

The next implementation step should be:

1. clean up Aelio Server boot/setup and route boundaries
2. fix the tenant identity contract
3. define SunJet as internal Aelio memory in code and docs

Only after that should we harden Convox and then the widget.

## Decision Summary

The v1 decisions are:

- `Aelio Server` is the product center
- `SunJet` is part of Aelio, not a separate product concept
- `Convox SDK` is the customer backend capability bridge
- `Widget SDK` is a thin client
- tenant slug is the public identifier
- signed identity and signed execute paths are required production contracts
- demo experience must not define production architecture
