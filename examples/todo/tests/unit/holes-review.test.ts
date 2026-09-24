import { describe, expect, it } from "vitest";
import {
  evaluateHolesReview,
  holesReviewAllowed,
  isHolesReviewArtifact,
  isImplementationPath,
  validateHolesReviewArtifact,
} from "../../scripts/holes-review.js";

const validArtifact = `# Holes review — createTodo

## Ambiguities
Who owns title trimming — UI or domain?

## Contradictions
OpenAPI maxLength 120 vs UI allowing longer paste.

## Missing AC
No AC for concurrent complete of the same todo.

## Unhappy/edge
Empty title, whitespace-only title, unknown id on complete.
`;

describe("holes-review path helpers", () => {
  it("detectsImplementationUnderSrc", () => {
    expect(isImplementationPath("src/domain/todo.ts")).toBe(true);
    expect(isImplementationPath("src/api/app.ts")).toBe(true);
    expect(isImplementationPath("features/todos.feature")).toBe(false);
    expect(isImplementationPath("docs/holes-review/x.md")).toBe(false);
  });

  it("detectsHolesReviewArtifacts", () => {
    expect(isHolesReviewArtifact("docs/holes-review/create-todo.md")).toBe(true);
    expect(isHolesReviewArtifact("docs/generated/gaps.md")).toBe(false);
    expect(isHolesReviewArtifact("docs/holes-review/nested/x.md")).toBe(true);
  });
});

describe("validateHolesReviewArtifact", () => {
  it("acceptsNonEmptyRequiredSections", () => {
    expect(validateHolesReviewArtifact(validArtifact).ok).toBe(true);
  });

  it("failsWhenSectionMissing", () => {
    const md = validArtifact.replace(
      "## Unhappy/edge\nEmpty title, whitespace-only title, unknown id on complete.\n",
      "",
    );
    const v = validateHolesReviewArtifact(md);
    expect(v.ok).toBe(false);
    expect(v.missingSections).toContain("Unhappy/edge");
  });

  it("failsWhenHeadersOnly", () => {
    const md = `## Ambiguities

## Contradictions

## Missing AC

## Unhappy/edge
`;
    const v = validateHolesReviewArtifact(md);
    expect(v.ok).toBe(false);
    expect(v.emptySections.length).toBe(4);
  });
});

describe("evaluateHolesReview", () => {
  it("skipsWhenDocsOnlyDiff", () => {
    const findings = evaluateHolesReview({
      appRelChanged: ["docs/ADOPT.md", "features/todos.feature"],
      grant: { allowed: false, reason: "none" },
      artifacts: [],
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
    expect(findings[0]?.message).toContain("no implementation");
  });

  it("failsWhenSrcChangeWithoutArtifactOrGrant", () => {
    const findings = evaluateHolesReview({
      appRelChanged: ["src/domain/todo.ts"],
      grant: { allowed: false, reason: "none" },
      artifacts: [],
    });
    expect(findings.some((f) => f.severity === "fail")).toBe(true);
    expect(findings.some((f) => f.message.includes("without"))).toBe(true);
  });

  it("passesWhenSrcChangeWithValidArtifactInSameDiff", () => {
    const findings = evaluateHolesReview({
      appRelChanged: ["src/domain/todo.ts", "docs/holes-review/todo.md"],
      grant: { allowed: false, reason: "none" },
      artifacts: [{ rel: "docs/holes-review/todo.md", content: validArtifact }],
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });

  it("failsWhenArtifactHasEmptySections", () => {
    const findings = evaluateHolesReview({
      appRelChanged: ["src/api/app.ts", "docs/holes-review/bad.md"],
      grant: { allowed: false, reason: "none" },
      artifacts: [
        {
          rel: "docs/holes-review/bad.md",
          content: "## Ambiguities\n\n## Contradictions\n\n## Missing AC\n\n## Unhappy/edge\n",
        },
      ],
    });
    expect(findings.some((f) => f.severity === "fail" && f.message.includes("empty"))).toBe(true);
  });

  it("passesWhenGrantedWithoutArtifact", () => {
    const findings = evaluateHolesReview({
      appRelChanged: ["src/domain/todo.ts"],
      grant: { allowed: true, reason: "HOLES_REVIEW_APPROVED=1" },
      artifacts: [],
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
    expect(findings[0]?.message).toContain("skipped via grant");
  });
});

describe("holesReviewAllowed", () => {
  it("honorsEnvAndConfigNotAllowFile", () => {
    const prev = process.env.HOLES_REVIEW_APPROVED;
    delete process.env.HOLES_REVIEW_APPROVED;
    expect(holesReviewAllowed("/tmp", false).allowed).toBe(false);
    expect(holesReviewAllowed("/tmp", true).allowed).toBe(true);
    process.env.HOLES_REVIEW_APPROVED = "1";
    expect(holesReviewAllowed("/tmp", false).allowed).toBe(true);
    if (prev === undefined) delete process.env.HOLES_REVIEW_APPROVED;
    else process.env.HOLES_REVIEW_APPROVED = prev;
  });
});
