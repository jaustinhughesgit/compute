# Compute Execution Layer

## Responsibility

This repository implements server-side entity and JPL execution, DynamoDB-backed platform operations, capability discovery/build/registry/edit/diagnosis, protected-asset brokering and audit, provider calls, background model responses, relationship modules, indexing, and other server capabilities.

It is the execution and persistence layer, not the owner of browser-local semantics.

## Owns

- Entity retrieval, versioning, execution, and server persistence
- JPL runtime semantics, schemas, validation, and safe module availability
- Parent/child lineage execution mechanics and relationship operations
- General `map`, `extend`, `link`, `use`, and `substitute` mechanics
- Capability manifests, entity plans, registries, generation, editing, diagnosis, and typed output validation
- Provider request execution and sanitized provider diagnostics
- Trusted-server protected-asset storage, consent enforcement, scoped resolution, use, and audit
- Durable model/build/repair jobs and idempotent application
- Server-side authorization enforcement

## Does not own

- Browser-local Path signature matching
- Ordinary local ContextDB question routing
- Browser persistence and refresh lifecycle
- The public CORS/proxy contract
- A claim of zero-knowledge when server code can resolve plaintext

## Entity and JPL generation

Generators must receive the authoritative schema, allowed modules, runtime reference syntax, protected-asset rules, current entity and manifest when editing, linked semantic evidence, and validation feedback. They should return structured patches or schema-bound documents rather than JSON embedded in prose.

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

## Background lifecycle

Entity creation and repair may outlive a Lambda request. Jobs require stable identity, owner and authorization scope, original request hash, phase/state, model response handle, retry count, checkpointed artifacts, terminal result, expiration, and idempotent application. SQS or another durable trigger can continue work; the website polls status through fresh requests.

## Verification focus

- Schema-invalid and semantically invalid model output
- Exact ordinary input propagation into JPL actions
- Parent/child execution order and failure handling
- Relationship behavior and authorization boundaries
- Provider response mapping and sanitized diagnostics
- Protected-asset host/scope/consent enforcement
- Job retry without duplicate side effects
- Entity/Path/context-aware repair and replay

