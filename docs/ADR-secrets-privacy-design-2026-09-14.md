# Design draft — superseded

This design draft was audited and **accepted** as
[`ADR-secrets-privacy.md`](./ADR-secrets-privacy.md) on 2026-09-14.

Hardening that landed (vs the draft):

- Scan set is tracked + staged + untracked-not-ignored (not git-diff-only)
- Local gitignored `.env` does not fail verify
- Reports never echo secret values
- Allowlist never waives `.env` / private keys; no `ALLOW_SECRETS=1`
- PII is fail-closed on fixture surfaces (checksum CPF/CNPJ + bundle + SSN)
- Token families extended (GitHub ghu/ghs/ghr, GitLab, Azure, OpenAI, Anthropic, npm)
- `.env.example` is not a content free pass
