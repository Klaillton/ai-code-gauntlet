import { describe, expect, it } from "vitest";
import {
  adrRefExists,
  evaluateAdrLint,
  extractStatusText,
  isAdrPath,
  isAdrScaffoldPath,
  parseAdrStatus,
  validateAdrDocument,
} from "../../scripts/adr-lint.js";

const validAdr = `# ADR-sample: Example

## Status

Accepted — 2026-09-24

## Context

Need a recorded decision.

## Decision

Use the light ADR gate.

## Consequences

New ADRs under docs/adr must fill the template.

## Discarded

- Skip ADRs entirely — rejected because we lose the why.
`;

describe("adr-lint path helpers", () => {
  it("detectsDocsAdrPaths", () => {
    expect(isAdrPath("docs/adr/ADR-sample.md")).toBe(true);
    expect(isAdrPath("docs/adr/nested/x.md")).toBe(true);
    expect(isAdrPath("docs/ADR-legacy.md")).toBe(false);
    expect(isAdrPath("docs/holes-review/x.md")).toBe(false);
  });

  it("detectsScaffoldPaths", () => {
    expect(isAdrScaffoldPath("docs/adr/TEMPLATE.md")).toBe(true);
    expect(isAdrScaffoldPath("docs/adr/README.md")).toBe(true);
    expect(isAdrScaffoldPath("docs/adr/ADR-sample.md")).toBe(false);
  });
});

describe("parseAdrStatus", () => {
  it("parsesAcceptedWithDate", () => {
    const s = parseAdrStatus("Accepted — 2026-09-24");
    expect(s).toEqual({ kind: "accepted", date: "2026-09-24" });
  });

  it("parsesSupersededWithDate", () => {
    const s = parseAdrStatus("Superseded by ADR-gates-source — 2026-09-24");
    expect(s).toEqual({
      kind: "superseded",
      ref: "ADR-gates-source",
      date: "2026-09-24",
    });
  });

  it("failsWithoutDate", () => {
    const s = parseAdrStatus("Accepted");
    expect(s.kind).toBe("invalid");
  });

  it("failsUnknownShape", () => {
    const s = parseAdrStatus("Draft — 2026-09-24");
    expect(s.kind).toBe("invalid");
  });
});

describe("validateAdrDocument", () => {
  it("acceptsCompleteAdr", () => {
    const v = validateAdrDocument(validAdr);
    expect(v.ok).toBe(true);
    expect(v.status?.kind).toBe("accepted");
  });

  it("failsWhenDiscardedEmpty", () => {
    const md = validAdr.replace(
      "## Discarded\n\n- Skip ADRs entirely — rejected because we lose the why.\n",
      "## Discarded\n\n",
    );
    const v = validateAdrDocument(md);
    expect(v.ok).toBe(false);
    expect(v.emptySections).toContain("Discarded");
  });

  it("failsWhenSectionMissing", () => {
    const md = validAdr.replace(
      "## Consequences\n\nNew ADRs under docs/adr must fill the template.\n\n",
      "",
    );
    const v = validateAdrDocument(md);
    expect(v.ok).toBe(false);
    expect(v.missingSections).toContain("Consequences");
  });

  it("acceptsMetadataStatusLine", () => {
    const md = `# ADR-meta

- **Status:** Accepted — 2026-01-02

## Context
c

## Decision
d

## Consequences
x

## Discarded
- alt — no
`;
    // Status extracted from metadata; ## Status heading absent is ok
    expect(extractStatusText(md)).toMatch(/Accepted/);
    const v = validateAdrDocument(md);
    expect(v.ok).toBe(true);
  });
});

describe("adrRefExists", () => {
  it("matchesBasename", () => {
    expect(adrRefExists("ADR-gates-source", ["docs/adr/ADR-gates-source.md"])).toBe(true);
    expect(adrRefExists("ADR-gates-source", ["docs/adr/ADR-gates-source-v2.md"])).toBe(true);
    expect(adrRefExists("ADR-missing", ["docs/adr/ADR-other.md"])).toBe(false);
    expect(adrRefExists("ADR-x", ["docs/adr/TEMPLATE.md"])).toBe(false);
  });
});

describe("evaluateAdrLint", () => {
  it("skipsWhenNoAdrTouched", () => {
    const findings = evaluateAdrLint({
      changed: [{ rel: "src/domain/x.ts", status: "M", content: "" }],
      existingAdrPaths: [],
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
    expect(findings[0]?.message).toMatch(/skipped/);
  });

  it("failsWhenAdrDeleted", () => {
    const findings = evaluateAdrLint({
      changed: [{ rel: "docs/adr/ADR-old.md", status: "D" }],
      existingAdrPaths: [],
    });
    const fails = findings.filter((f) => f.severity === "fail");
    expect(fails).toHaveLength(1);
    expect(fails[0]?.message).toMatch(/do not delete/);
  });

  it("failsWhenDiscardedEmptyOnChangedAdr", () => {
    const bad = validAdr.replace(
      "## Discarded\n\n- Skip ADRs entirely — rejected because we lose the why.\n",
      "## Discarded\n\n",
    );
    const findings = evaluateAdrLint({
      changed: [{ rel: "docs/adr/ADR-sample.md", status: "A", content: bad }],
      existingAdrPaths: ["docs/adr/ADR-sample.md"],
    });
    expect(findings.some((f) => f.severity === "fail" && f.message.includes("Discarded"))).toBe(
      true,
    );
  });

  it("failsSupersededWhenTargetMissing", () => {
    const md = validAdr.replace(
      "Accepted — 2026-09-24",
      "Superseded by ADR-replacement — 2026-09-24",
    );
    const findings = evaluateAdrLint({
      changed: [{ rel: "docs/adr/ADR-sample.md", status: "M", content: md }],
      existingAdrPaths: ["docs/adr/ADR-sample.md"],
    });
    expect(findings.some((f) => f.message.includes("ADR-replacement"))).toBe(true);
  });

  it("passesSupersededWhenTargetExists", () => {
    const md = validAdr.replace(
      "Accepted — 2026-09-24",
      "Superseded by ADR-replacement — 2026-09-24",
    );
    const findings = evaluateAdrLint({
      changed: [{ rel: "docs/adr/ADR-sample.md", status: "M", content: md }],
      existingAdrPaths: ["docs/adr/ADR-sample.md", "docs/adr/ADR-replacement.md"],
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });

  it("ignoresScaffoldBody", () => {
    const findings = evaluateAdrLint({
      changed: [{ rel: "docs/adr/TEMPLATE.md", status: "M", content: "# no sections" }],
      existingAdrPaths: [],
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
    expect(findings.some((f) => f.message.includes("scaffold"))).toBe(true);
  });

  it("passesValidNewAdr", () => {
    const findings = evaluateAdrLint({
      changed: [{ rel: "docs/adr/ADR-sample.md", status: "A", content: validAdr }],
      existingAdrPaths: ["docs/adr/ADR-sample.md"],
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
    expect(findings.some((f) => f.message.includes("accepted"))).toBe(true);
  });
});
