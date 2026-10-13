# Observability

Presence gate **D15** checks heading + ≥1 requirement list item.
Quality of content is Spec's job (lorem/TODO-only still passes).

## Requirements

- Emit structured request logs with a correlation id
- Expose a probe-ready health check (`/health`)
- Record HTTP 5xx rates without including secret payloads
