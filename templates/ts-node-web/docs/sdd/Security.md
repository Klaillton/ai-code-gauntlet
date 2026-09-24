# Security

Presence gate **D15** checks heading + ≥1 requirement list item.
Quality of content is Spec's job (lorem/TODO-only still passes).

## Requirements

- Authenticate mutating APIs with a verified session or token
- Never log secrets, credentials, or raw PII
- Deny by default: unknown routes must not leak internals
