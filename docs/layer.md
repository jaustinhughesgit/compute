# Compute Execution Layer

## Responsibility

This repository implements server-side entity and JPL execution, DynamoDB-backed platform operations, capability discovery/build/registry/edit/diagnosis, protected-asset brokering and audit, provider calls, background model responses, relationship modules, indexing, and other server capabilities.

It is the server execution and persistence layer, not the owner of browser-local semantics. Data-defined local semantic entities that describe ContextDB row operations belong to `aws`; they are not remote Compute applications and must not be promoted into JPL merely because a Path was missing.

## Owns

- Entity retrieval, versioning, execution, and server persistence
- JPL runtime semantics, schemas, validation, and safe module availability
- Parent/child lineage execution mechanics and relationship operations
- General `map`, `extend`, `link`, `use`, and `substitute` mechanics
- Capability manifests, entity plans, registries, generation, editing, diagnosis, and typed output validation
- Contract-based capability reuse, compatible repair/versioning, fork/lineage decisions, installation references, and promotion/deprecation lifecycle
- Provider request execution and sanitized provider diagnostics
- Trusted-server protected-asset storage, consent enforcement, scoped resolution, use, and audit
- Durable model/build/repair jobs and idempotent application
- Server-side authorization enforcement
- Fail-closed authorization and environment scoping for destructive test operations
- Scheduled task persistence, EventBridge invocation, and due-occurrence execution
- Account/email-verification records and public device-key/authenticator registration
- Streaming presence, invitations, scoped session credentials, and channel lifecycle
- SES email delivery, consent, rate/reputation safeguards, suppression, and bounce events
- Idempotent publication, versioning, linking, authorization, and hydration of ordinary local entities and hard-data facts
- Recipient/device protected-asset grants, envelope retrieval, key-version lifecycle, and zero-trust sharing metadata
- Sanitized model usage traces for discovery, generation, interpretation, diagnosis, and verification responses
- Trusted resolution of versioned LLM template IDs for compute discovery, generation, interpretation, diagnosis, and verification

## Does not own

- Browser-local Path signature matching
- Ordinary local ContextDB question routing
- Primary classification and execution of ordinary local fact, event, delta, relationship, and correction mutations
- Browser persistence and refresh lifecycle
- The public CORS/proxy contract
- A claim of zero-knowledge when server code can resolve plaintext

## Entity and JPL generation

Generators must receive the authoritative schema, allowed modules, runtime reference syntax, protected-asset rules, current entity and manifest when editing, linked semantic evidence, and validation feedback. They should return structured patches or schema-bound documents rather than JSON embedded in prose.

Generation is the last capability option, not the generic fallback for every Path miss. Compute must reject or return local-routing diagnostics when validated evidence identifies an ordinary graph operation. An exact compatible contract is reused across callers with separate bindings and installations. A defect may revise implementation only while its semantic contract remains unchanged; a contract delta in inputs, outputs, operations, effects, guarantees, or trust requirements must create a fork/child or new root rather than silently edit the source.

Bulk Path persistence validates every submitted Path before writing any member of the batch. A validation failure returns the rejected signatures with zero writes; callers must never interpret a partially accepted foundation dataset as complete.

The optional Path creator-audit index key is written only when the authenticated cookie supplies a nonempty creator identity. Identity-scoped Path ownership continues to use the separately resolved target identity; persistence must not invent an audit actor or send an empty secondary-index key when creator metadata is unavailable.

Path-family normalization must preserve browser-validated exact aliases. Derived numeric answer operations such as sum, subtraction, division, and count are all quantity-answer contracts for alias compatibility; persistence must not discard an installed wording merely because its canonical query expresses the answer through an arithmetic operator.

Reviewed Path foundation promotion is distinct from identity-scoped Path persistence. Compute accepts only an authenticated, explicitly authorized confirmation of an exact Path carrying an originating sentence plus passing browser-test or dataset-quality evidence. It stores that artifact and promotion provenance in the retained `PathFoundationTable`. Listing the shared foundation is read-only hydration; browser-local compilation and testing remain the semantic authority.

Validation should cover:

1. JSON syntax and schema
2. Forbidden keys and unsafe references
3. Module/action availability
4. Input consumption and output production
5. Provider host and parameter policy
6. Protected-asset requirements
7. Manifest/JPL/template semantic alignment
8. Isolated runtime result against fixtures

## Provider protocols

Provider knowledge belongs in reusable versioned entities or protocol lineages. The core runtime supplies generic HTTP, transformation, credential-reference, validation, and diagnostic mechanics. A provider entity supplies endpoints, parameter definitions, response mappings, versions, and provider-specific normalization.

This preserves the long-term direction in which providers or builders can publish their protocol work through 1var rather than requiring every end-user entity to rediscover an API.

## Distributed entities

Compute capabilities are one entity subtype. The server also persists hard data, structure, interaction assets, and reusable entity content. A browser publication request must create or resolve typed nodes and relations idempotently, return authoritative IDs/versions, preserve provenance and ownership, and apply public/private plus action-level authorization. Cross-user graph queries must be scoped by the caller's grants; creator identifiers are not authorization tokens.

## Recipient-specific protected sharing

The server stores opaque content ciphertext and per-recipient/device wraps created locally. Recipient retrieval requires an active grant bound to the authenticated principal and public-key version, but does not confer owner authority. Executor/KMS wraps remain a separate trusted-server option. Membership changes, key rotation, recipient removal, and future-version confidentiality require explicit rewrap or re-encryption lifecycle operations.

## Background lifecycle

Entity creation and repair may outlive a Lambda request. Jobs require stable identity, owner and authorization scope, original request hash, phase/state, model response handle, retry count, checkpointed artifacts, terminal result, expiration, and idempotent application. SQS or another durable trigger can continue work; the website polls status through fresh requests.

Repair and fork jobs are distinct lifecycle operations. A published repair creates an immutable compatible implementation release in the same capability lineage. A fork creates a separate identity with explicit source lineage and cannot replace or migrate dependents without a separately authorized promotion decision.

Completed model responses expose only the versioned cost-trace fields needed for local estimation: provider, model, response identity, service tier, named step, and aggregate token counts. Prompt/output content, hidden reasoning, credentials, headers, and protected values do not belong in this metadata. Polling responses must preserve one response identity so the browser can deduplicate cost.

Background model work also preserves the request's normalized `llmTemplateId`. Compute resolves the ID through a server-owned route registry; a browser value can select only a known template, never an arbitrary model or reasoning parameter. Unknown or omitted IDs use Original.

## Scheduled tasks

Time-triggered work still executes an entity through ordinary lineage, authorization, input, protected-asset, and audit rules. Each occurrence needs stable identity and idempotency. Persist the user's time zone and recurrence intent, re-check permissions at execution, and keep retry/dead-letter state observable.

## Identity, streaming, and email

Compute stores public device/authenticator material and verification state, but must not imply that credential enrollment alone authorizes a later protected operation. Streaming credentials must be short-lived and scoped to the required Kinesis channel actions. Email delivery must preserve consent, unsubscribe, suppression, rate, bounce, complaint, domain-authentication, and reputation controls for every source, including scheduled tasks and automations.

## Test-environment operations

The `resetDB` action is destructive and is never enabled merely because a caller knows its route. It fails before acquiring a DynamoDB client unless the deployment explicitly enables reset, declares an exact non-production environment identity, and the request repeats that identity. The normal mode requires an authenticated user allow-list. During the current disposable-stack testing phase, the explicitly configured `TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER` compatibility switch temporarily allows any caller, including an anonymous portal session; the legacy name is retained to avoid changing deployment configuration. Environment, enablement, and request-identity checks still fail closed. The companion client guard in `testing` prevents common operator mistakes but is not an authorization boundary. Prefer disposable test stacks or per-run namespaces as concurrency grows.

`resetDB` clears the identity-scoped `paths` table but intentionally does not clear `PathFoundationTable`. A reset therefore removes unconfirmed learned coverage while preserving explicitly reviewed equations that every new account should hydrate. Clearing or revoking the shared foundation is a separate governed lifecycle action and is not implied by test reset.

The portal may call `resetDBStatus` to obtain the configured non-secret environment identity and availability state, then submit that identity to `resetDB` after explicit user confirmation. In allow-list mode, an authenticated but unauthorized caller receives its own account ID for administrator configuration but no environment identity. In temporary any-caller mode, anonymous callers receive the environment identity. This removes operator guesswork without weakening the server-side enable flag or exact environment check.

## Verification focus

- Schema-invalid and semantically invalid model output
- Exact ordinary input propagation into JPL actions
- Parent/child execution order and failure handling
- Relationship behavior and authorization boundaries
- Provider response mapping and sanitized diagnostics
- Protected-asset host/scope/consent enforcement
- Job retry without duplicate side effects
- Entity/Path/context-aware repair and replay
- Schedule idempotency, daylight-saving behavior, authorization expiry, and dead-letter recovery
- Device enrollment, assertion, key rotation, revocation, and recovery states
- Streaming invitation/participant authorization and credential scope
- SES bounce/complaint handling, unsubscribe behavior, suppression, and deployed reputation configuration
- Idempotent entity publication, typed values, ID/version acknowledgements, permission-scoped hydration, and tombstone/conflict behavior
- Recipient-only envelope retrieval, wrong-device/key denial, recipient removal, re-encryption, and separation from executor wraps
- Cost-trace normalization across Responses and Chat Completions usage shapes, including retry deduplication and content exclusion
- Original/New template routing, endpoint-correct reasoning fields, unknown-ID fallback, and background continuity
- Deterministic contract diff for reuse versus compatible repair versus fork, including source stability and dependent Path compatibility
- Two users reusing one capability definition with isolated ordinary data, configuration, permissions, and protected-asset bindings
- Reset denial when disabled or the environment identity mismatches; in normal allow-list mode also deny unauthenticated and unlisted callers before database access
