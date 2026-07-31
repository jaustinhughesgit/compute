# Compute Layer Instructions

This repository is the entity, JPL, persistence, capability, and protected-execution layer of the larger 1var platform. Read `../architecture/README.md`, `../architecture/docs/platform-model.md`, `../architecture/docs/security-and-trust.md`, and `docs/layer.md` before changing entity relationships, JPL, capability generation, editing, protected assets, or background jobs.

## Guardrails

- Use entities, lineage, relationships, JPL, Paths/manifests, permissions, and protected-asset contracts as reusable primitives. Do not add provider- or scenario-specific bypasses to the core runtime.
- Treat `map`, `extend`, `link`, `use`, and `substitute` as general mechanics. Preserve their full semantics and authorization behavior.
- Model output is untrusted. Require strict structured output, schema validation, safe patching, semantic validation, and isolated execution before activation.
- Keep entity implementation, capability manifest, ordinary input bindings, typed outputs, answer templates, and examples semantically aligned.
- Editing may require entity, Path semantic contract, context binding, or combined repair. Provide linked evidence; do not rewrite user facts to compensate for broken code.
- Long OpenAI work must use durable, idempotent background jobs with checkpointed status and bounded retries.
- Never expose plaintext protected assets to prompts, logs, diagnostics, entity JSON, or ordinary persistence. Distinguish trusted-server execution from zero-knowledge local execution.
- Preserve actionable sanitized provider and validation diagnostics.
- Scheduled invocations must re-check entity and protected-asset authority and be idempotent per occurrence.
- Streaming credentials must be short-lived and least-privilege; presence alone never authorizes joining or publishing.
- Email from entities, automations, and schedules must share consent, unsubscribe, suppression, bounce/complaint, quota, and reputation enforcement.
- Treat compute as one entity behavior, not the entity definition. Preserve durable hard-data and interaction entities, typed relations, provenance, versions, and general relationship mechanics.
- Entity publication and hydration must be idempotent and permission-scoped. Never authorize bulk graph access from a caller-supplied creator ID alone.
- Recipient key-wrap metadata does not itself authorize retrieval. Require an active principal/device grant and keep recipient access distinct from owner and executor authority.

Update `docs/layer.md`, shared contracts, and architecture decisions when compute changes a cross-layer invariant.
