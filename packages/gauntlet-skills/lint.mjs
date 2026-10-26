// skills-lint: a canonical skill must never instruct an agent to bypass the gauntlet.
//
// Rule (kept deliberately simple, see README.md):
//   A forbidden instruction is a finding unless the SAME CLAUSE states a prohibition
//   (never / do not / don't / must not / cannot / forbidden / prohibited / not allowed / revert).
// A clause is a sentence or a `;`-separated part of one markdown paragraph or list item
// (soft-wrapped lines are joined first). Inside a code fence every line is its own clause.
// There is no allow marker: rewrite the line as a prohibition instead.

const NEGATION =
  /\b(?:never|do not|don't|dont|must not|must never|cannot|can't|not allowed|forbidden|prohibited|revert(?:s|ed)?)\b/i;

const GRANT =
  /\b(?:policy-change|specs?|deps|holes(?:-review)?|spec-sync)-approved\b|\b(?:POLICY_CHANGE_APPROVED|ALLOW_SPEC_EDIT|ALLOW_DEPS_EDIT|HOLES_REVIEW_APPROVED|SPEC_SYNC_APPROVED)=1\b/i;
const APPLY =
  /\b(?:apply|applies|applying|applied|add|adds|adding|set|sets|setting|put|attach\w*|export\w*)\b|\blabel(?:s|ing)?\s+(?:the|this|your)\s+(?:pr|pull request|issue)\b|--add-label\b|\bgh\s+(?:pr|issue)\s+edit\b|\/labels\b/i;
const GH_CALL =
  /(?:^|[\s`$(|&;])gh\s+(?:pr|api|issue|label|repo|run|workflow|release|secret|auth|search|gist|cache|variable|ruleset)\b/i;
const GH_TOKEN = /\bGH_TOKEN=/;

export const RULES = [
  {
    id: "skip-hooks",
    why: "bypasses git hooks (--no-verify / skip hooks)",
    test: (c) =>
      /--no-verify\b|\bHUSKY=0\b|\bskip(?:ping|s)?\s+(?:the\s+)?(?:git\s+|pre-commit\s+|commit\s+)?hooks?\b/i.test(
        c,
      ),
  },
  {
    id: "disable-tests",
    why: "skips, focuses, disables, or deletes tests",
    test: (c) =>
      /\b(?:it|test|describe|context|suite)\.(?:only|skip)\b|\.(?:only|skip)\s*\(|\bx(?:it|describe|test)\b|@Disabled\b|@Ignore\b|-DskipTests\b|\bmaven\.test\.skip\b|\bskip(?:ping|s)?\s+(?:(?:the|all|any|failing|flaky|some|slow)\s+){0,2}tests?\b|\b(?:disabl|delet|remov)\w*\s+(?:(?:the|a|an|any|failing|flaky|slow|red)\s+){0,2}(?:tests?|scenarios?)\b|\bcomment(?:ing)?\s+out\s+(?:the\s+|a\s+)?tests?\b/i.test(
        c,
      ),
  },
  {
    id: "lower-thresholds",
    why: "lowers coverage / mutation / quality thresholds",
    test: (c) =>
      /\b(?:lower|reduc|decreas|relax|weaken|loosen|drop)\w*\b[^.;\n]{0,40}?\b(?:thresholds?|coverage|floors?|kill-score|mutation score)\b|\b(?:thresholds?|coverage|floors?)\b[^.;\n]{0,20}?\b(?:lower|reduc|decreas|relax|weaken)\w*/i.test(
        c,
      ),
  },
  {
    id: "apply-grant",
    why: "applies a human-only grant label / env",
    test: (c) => GRANT.test(c) && APPLY.test(c),
  },
  {
    id: "gh-without-token",
    why: "runs gh without an explicit GH_TOKEN (default login is the owner identity)",
    test: (c, ctx) => GH_CALL.test(c) && !GH_TOKEN.test(ctx),
  },
];

/** Split markdown into units: { line, context, clauses[] }. */
export function units(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = null;
  const flush = () => {
    if (para) {
      const joined = para.lines.join(" ");
      const clauses = joined
        .split(/;|(?<=[.!?])\s+(?=[A-Z*`[(])/)
        .filter((c) => c.trim() !== "");
      out.push({ line: para.line, context: joined, clauses });
      para = null;
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      const start = i;
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*(```|~~~)/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const context = body.join("\n");
      body.forEach((l, k) => {
        if (l.trim() !== "")
          out.push({ line: start + 2 + k, context, clauses: [l] });
      });
      continue;
    }
    const blank = raw.trim() === "";
    const startsBlock = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/.test(raw);
    if (blank || startsBlock) flush();
    if (blank) continue;
    if (!para) para = { line: i + 1, lines: [] };
    para.lines.push(raw.trim());
    if (/^\s*#{1,6}\s/.test(raw)) flush();
  }
  flush();
  return out;
}

/** Lint one skill's markdown. Returns findings [{ line, rule, why, text }]. */
export function lintSkill(text) {
  const findings = [];
  for (const unit of units(text)) {
    for (const clause of unit.clauses) {
      const plain = clause.replace(/[*_]{1,2}(?=\w)|(?<=\w)[*_]{1,2}/g, "");
      if (NEGATION.test(plain)) continue;
      for (const rule of RULES) {
        if (rule.test(clause, unit.context)) {
          findings.push({
            line: unit.line,
            rule: rule.id,
            why: rule.why,
            text: clause.trim().slice(0, 120),
          });
        }
      }
    }
  }
  return findings;
}
