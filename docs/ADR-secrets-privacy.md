# ADR: secrets-scan — credentials and privacy hard gate

- **Status:** Accepted
- **Date:** 2026-09-14
- **Context:** AI Code Gauntlet kit (`Klaillton/ai-code-gauntlet`)
- **Related:** [ADR-spec-sync-drift.md](./ADR-spec-sync-drift.md),
  [ADR-phase2-deps-spec-review.md](./ADR-phase2-deps-spec-review.md)
- **Supersedes:** design draft `docs/ADR-secrets-privacy-design-2026-09-14.md`

## Context

Agents can still land secrets and pass `npm run verify` if `.gitignore` is the
only control (`git add -f .env`) or if credentials / PII are inlined in source
or fixtures. `AGENTS.md` had a one-liner under “Other”. D8 is a different
concern (Gherkin UI leakage). There was no fail-closed secrets gate.

The original design scanned git-diff surfaces the same way as protect-specs.
That is the **wrong scan set for secrets**:

| Surface | Why it matters | Diff-only? |
|---------|----------------|------------|
| Local gitignored `.env` | Normal dotenv workflow | Must **not** fail |
| `git add -f .env` | Bypass gitignore | **Must fail** |
| Secret already committed | Empty current diff | **Must fail** |
| Untracked `src/leak.ts` | Agent just wrote it | **Must fail** |

Reports that echo the matched line (the no-cheat pattern) would **re-leak**
secrets into `*-report.json` and CI artifacts.

## Decision

Ship **`secrets-scan`** as a fail-closed verify gate, after `deps-lock` and
before `no-cheat`. Zero new npm dependencies. Same script in `examples/todo`
and `templates/ts-node-web`. Adopt CLI copies and wires it.

Discipline lives in the tool, not prompt politeness. There is **no**
`ALLOW_SECRETS=1`.

## Key decisions

1. **Scan set is git-aware, not diff-only.** Union of `git ls-files` (tracked /
   staged, including `git add -f`) and `git ls-files --others --exclude-standard`
   (untracked, not ignored). Full tree of those paths every verify — empty
   diffs still catch committed secrets.
2. **Local gitignored `.env` does not fail.** Without git, walk the working
   tree but skip `.env` / private-key **filenames** (still scan source content).
3. **Findings never echo secret values.** Message is rule + path + line only.
4. **Allowlist never waives `.env` or PEM / key filenames.** Optional exact
   path waivers exist only for token-shape / assignment / PII false positives.
   Agents must not add entries; stop and ask a human.
5. **PII is fail-closed on fixture surfaces**, not AGENTS-only. High-confidence
   only: valid CPF/CNPJ (checksum), SSN-like, or document+phone+email bundle in
   `features/` / `e2e/` / `fixtures/`. Synthetic `example.com` / `555` phones
   do not count toward the bundle.
6. **Stripe: ban `sk_live_`, allow `sk_test_`.** Content scan includes
   `*.yml` / `*.properties` / `.env*` (example files are not path-forbidden,
   but a real `AKIA…` inside `.env.example` still fails).
7. **No `enabled: false`.** Same fail-closed bar as the rest of verify / D9.

## Scan set

Skip `node_modules/`, `coverage/`, `dist/`, `playwright-report/`,
`test-results/`, `.git/`, `*.map`, `*-report.json`, `package-lock.json`,
binaries, files > 1MB, NUL bytes.

`.env.example`, `*.env.example`, `.env.sample`, `.env.template` are **not**
forbidden paths; content rules still apply.

## Fail rules

**A. Forbidden paths** (tracked / staged / untracked-not-ignored)

- `.env`, `.envrc`, `.env.*`, `*.env` except example/sample/template names
- `id_rsa`, `id_ed25519`, `id_dsa`, `id_ecdsa` (not `.pub`)

**B. Private key PEM**

`-----BEGIN (RSA | OPENSSH | EC | DSA | ENCRYPTED | PGP )?PRIVATE KEY( BLOCK)?-----`

**C. Token shapes (high signal)**

AWS `AKIA…`, GitHub `ghp|gho|ghu|ghs|ghr_` and `github_pat_`, GitLab `glpat-`,
Slack token / incoming webhook, Stripe `sk_live_`, Google `AIza…`, OpenAI
`sk-proj-`, Anthropic `sk-ant-`, npm `npm_`, Azure `AccountKey=` /
`SharedAccessKey=` (22+ chars).

**D. Hardcoded assignments**

`(password|passwd|secret|token|api[_-]?key|client_secret|…)\s*[:=]\s*` quoted or
bare value of length ≥ 8. Placeholders skipped (`changeme`, `your-`, `xxx`,
`EXAMPLE`, `REDACTED`, `process.env`, `${…}`, `<…>`, `true`/`false`/`null`).

**E. Privacy / PII** (only `features/**`, `e2e/**`, `**/fixtures/**`)

- Bundle: formatted CPF or CNPJ **and** phone **and** non-synthetic email
- Standalone valid CPF / CNPJ (checksum)
- Standalone SSN-like `\d{3}-\d{2}-\d{4}` (invalid area 000/666/9xx excluded)

## Allowlist / grants

**No** standing env override.

Human-only, exact paths:

1. `gauntlet.config.json` → `secretsScan.allowPaths` (PR-visible)
2. `.gauntlet/allow-secrets-paths` (gitignored, local)

Never waives rules `forbidden-path`, `private-key`, `private-key-file`.

## Artifacts

- `secrets-scan-report.json` (`ok`, `findings[{id,severity,path,rule,line,message}]`)
- Folded into `gauntlet-report.json` as `secretsScan`
- Report path is gitignored (`*-report.json` + explicit name)

## Wiring

```
… → protect-specs → deps-lock → secrets-scan → no-cheat → spec-sync → …
```

- `npm run secrets-scan` → `tsx scripts/secrets-scan.ts`
- Gate in Todo + template `gauntlet.config.json`
- `create-ai-gauntlet` `HARDENING_GATE_IDS` + `ensureGate` after deps-lock
  (or after protect-specs if no deps-lock script)
- AGENTS hard section; spec-review / implement-feature / write-gherkin /
  fix-until-green updated

## Known limitations (still out of the local gate)

- Obfuscation (`"AKIA" + "…"`, hex dumps, unicode tricks)
- Generic high-entropy strings / JWTs (too noisy)
- Local verify does **not** scan git history (current tree / index /
  untracked-not-ignored only)

## C follow-up (2026-09-18)

- **gitleaks** is an **additional CI job** (`gitleaks detect` on full history,
  report redacted). It does **not** replace `secrets-scan`; agents still run
  verify with zero extra installs.
- Forbidden paths also include `.netrc` / `_netrc`.
- `*.yml` / `*.properties` were already in the content scan of tracked files.
  Java-specific globs wait for a Spring adopt.

## Consequences

- A planted AWS key or PEM in `src/` fails `secrets-scan` and `verify`
- `.env.example` with `API_KEY=your-key-here` passes
- Committed or `git add -f` `.env` fails; a local gitignored `.env` does not
- Adopt on a skeleton gets the gate without `enabled: false`
- False positives: human path waiver or fix the string; agents stop and ask

## Acceptance

Covered by `tests/unit/secrets-scan.test.ts` (Todo + template) plus clean
`npm run verify` on both apps.
