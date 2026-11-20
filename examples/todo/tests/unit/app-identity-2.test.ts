/**
 * app-identity-2 — adversarial tests agreed by Gate + Challenge (2026-11-05):
 * grant = label (intent) + APPROVED review by the repo OWNER (never an agent) on the exact head SHA.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type GitHubFetch,
  type ReviewRecord,
  HUMAN_UNATTRIBUTED,
  SHARED_TOKEN_LOGINS_UNSET_REASON,
  parseSharedTokenLogins,
  resolveHumanGrant,
} from "../../scripts/human-grant.js";

const LABEL = "policy-change-approved";
const OLD = "a".repeat(40);
const HEAD = "b".repeat(40);
const REPO = "Klaillton/ai-code-gauntlet";
const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function prEvent(headSha = HEAD): string {
  const dir = mkdtempSync(join(tmpdir(), "app-identity-2-"));
  temps.push(dir);
  const path = join(dir, "event.json");
  writeFileSync(path, JSON.stringify({ pull_request: { number: 7, head: { sha: headSha } } }));
  return path;
}

type FakePr = { labels: string[]; headSha: string; reviews: ReviewRecord[] };

function fakeApi(pr: FakePr): GitHubFetch {
  return (path: string) => {
    if (path === `/repos/${REPO}/pulls/7`) {
      return { number: 7, head: { sha: pr.headSha }, labels: pr.labels.map((name) => ({ name })) };
    }
    if (path.startsWith(`/repos/${REPO}/pulls/7/reviews`)) {
      return path.includes("page=1") ? pr.reviews : [];
    }
    throw new Error(`unexpected GET ${path}`);
  };
}

function review(
  login: string,
  commit: string,
  state = "APPROVED",
  type = "User",
  association: string | null = "OWNER",
): ReviewRecord {
  return {
    user: { login, type },
    author_association: association,
    state,
    commit_id: commit,
    submitted_at: "2026-11-20T10:00:00Z",
  };
}

function grant(pr: FakePr, extraEnv: NodeJS.ProcessEnv = {}, eventHead = HEAD) {
  return resolveHumanGrant({
    label: LABEL,
    envFlag: "POLICY_CHANGE_APPROVED",
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_PATH: prEvent(eventHead),
      GAUNTLET_SHARED_TOKEN_LOGINS: "Klaillton",
      ...extraEnv,
    },
    fetchJson: fakeApi(pr),
  });
}

describe("app-identity-2 adversarial (Gate + Challenge, 2026-11-05)", () => {
  it("1 labelWithoutReviewFails", () => {
    const result = grant({ labels: [LABEL], headSha: HEAD, reviews: [] });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("without a human APPROVED review");
  });

  it("2 reviewFromTheAppOrAnotherAgentFails", () => {
    const app = grant({
      labels: [LABEL],
      headSha: HEAD,
      reviews: [review("klaillton-gauntlet-agents[bot]", HEAD, "APPROVED", "Bot")],
    });
    expect(app.allowed).toBe(false);
    expect(app.reason).toContain("agent reviews never grant");
    const listed = grant(
      { labels: [LABEL], headSha: HEAD, reviews: [review("some-agent-user", HEAD)] },
      { GAUNTLET_AGENT_LOGINS: "some-agent-user" },
    );
    expect(listed.allowed).toBe(false);
  });

  it("3 reviewOnAnOlderShaFails", () => {
    const result = grant({ labels: [LABEL], headSha: HEAD, reviews: [review("dante-human", OLD)] });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("approvals on other SHAs do not count");
  });

  it("4 approvedThenNewCommitFailsEvenIfGitHubDidNotDismiss", () => {
    // The approval stays APPROVED on the old commit; a new commit became the head.
    const moved = grant({ labels: [LABEL], headSha: HEAD, reviews: [review("dante-human", OLD)] });
    expect(moved.allowed).toBe(false);
    // Stale run: this run checks the approved commit, but the PR head already moved on.
    const stale = grant(
      { labels: [LABEL], headSha: HEAD, reviews: [review("dante-human", OLD)] },
      {},
      OLD,
    );
    expect(stale.allowed).toBe(false);
    expect(stale.reason).toContain("head moved");
  });

  it("5 sharedTokenHumanReviewOnHeadFailsHumanUnattributedUntilRevoked", () => {
    const pr = { labels: [LABEL], headSha: HEAD, reviews: [review("Klaillton", HEAD)] };
    const shared = grant(pr);
    expect(shared.allowed).toBe(false);
    expect(shared.reason).toContain(HUMAN_UNATTRIBUTED);
    // After the shared token is revoked, the login leaves the list and the same review passes.
    const revoked = grant(pr, { GAUNTLET_SHARED_TOKEN_LOGINS: "none" });
    expect(revoked.allowed).toBe(true);
    expect(revoked.reason).toContain("Klaillton");
  });

  it("6 noLabelAndNoReviewFails", () => {
    const result = grant({ labels: [], headSha: HEAD, reviews: [] });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(`label ${LABEL} absent`);
  });

  it("7 externalAccountApprovalOnHeadWithLabelFailsOnlyOwnerGrants", () => {
    // Public repo: any account can leave an APPROVED review the API returns (Gate, 2026-11-20).
    for (const association of ["NONE", "CONTRIBUTOR", "COLLABORATOR", "MEMBER", null]) {
      const result = grant({
        labels: [LABEL],
        headSha: HEAD,
        reviews: [review("random-stranger", HEAD, "APPROVED", "User", association)],
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("only the repo OWNER grants");
    }
  });
});

describe("app-identity-2 GAUNTLET_SHARED_TOKEN_LOGINS is mandatory (fail closed)", () => {
  const ok = { labels: [LABEL], headSha: HEAD, reviews: [review("dante-human", HEAD)] };

  it("reasonTextIsTheAgreedOne", () => {
    expect(SHARED_TOKEN_LOGINS_UNSET_REASON).toBe(
      "GAUNTLET_SHARED_TOKEN_LOGINS por definir (fail closed)",
    );
  });

  it("8 variableAbsentWithOwnerApprovedOnHeadAndLabelFails", () => {
    const result = grant(ok, { GAUNTLET_SHARED_TOKEN_LOGINS: undefined });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(SHARED_TOKEN_LOGINS_UNSET_REASON);
  });

  it("9 variableEmptyOrWhitespaceFails", () => {
    for (const raw of ["", " ", "\t\n  "]) {
      const result = grant(ok, { GAUNTLET_SHARED_TOKEN_LOGINS: raw });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(SHARED_TOKEN_LOGINS_UNSET_REASON);
    }
  });

  it("10 onlyAnExplicitNoneMeansAnEmptyList", () => {
    for (const raw of ["none", "NONE", "  None \n"]) {
      const result = grant(ok, { GAUNTLET_SHARED_TOKEN_LOGINS: raw });
      expect(result.allowed).toBe(true);
    }
    // A dash or a bare separator is not "none": still fails closed.
    for (const raw of ["-", ",", " , "]) {
      const result = grant(ok, { GAUNTLET_SHARED_TOKEN_LOGINS: raw });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(SHARED_TOKEN_LOGINS_UNSET_REASON);
    }
  });

  it("11 variableNamingTheReviewerStillFailsHumanUnattributed", () => {
    const result = grant(
      { ...ok, reviews: [review("Klaillton", HEAD)] },
      { GAUNTLET_SHARED_TOKEN_LOGINS: "Klaillton" },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(HUMAN_UNATTRIBUTED);
  });

  it("12 theCheckComesBeforeAnyApiRead", () => {
    let calls = 0;
    const result = resolveHumanGrant({
      label: LABEL,
      envFlag: "POLICY_CHANGE_APPROVED",
      env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: REPO, GITHUB_EVENT_PATH: prEvent() },
      fetchJson: () => {
        calls += 1;
        return [];
      },
    });
    expect(result.reason).toBe(SHARED_TOKEN_LOGINS_UNSET_REASON);
    expect(calls).toBe(0);
  });

  it("13 localRunIgnoresTheVariable", () => {
    const result = resolveHumanGrant({
      label: LABEL,
      envFlag: "POLICY_CHANGE_APPROVED",
      env: { POLICY_CHANGE_APPROVED: "1" },
    });
    expect(result.allowed).toBe(true);
  });

  it("parseSharedTokenLoginsAcceptsListsAndRejectsEmpty", () => {
    expect(parseSharedTokenLogins(undefined)).toEqual({ ok: false });
    expect(parseSharedTokenLogins("  ")).toEqual({ ok: false });
    expect(parseSharedTokenLogins("None")).toEqual({ ok: true, logins: [] });
    expect(parseSharedTokenLogins("a, b c")).toEqual({ ok: true, logins: ["a", "b", "c"] });
  });
});

describe("app-identity-2 controls", () => {
  it("passesWithLabelAndHumanReviewOnTheExactHead", () => {
    const result = grant({
      labels: [LABEL],
      headSha: HEAD,
      reviews: [review("dante-human", HEAD)],
    });
    expect(result.allowed).toBe(true);
  });

  it("reviewWithoutLabelDoesNotGrantThatLabel", () => {
    const result = grant({
      labels: ["deps-approved"],
      headSha: HEAD,
      reviews: [review("dante-human", HEAD)],
    });
    expect(result.allowed).toBe(false);
  });

  it("laterChangesRequestedRevokesTheApproval", () => {
    const result = grant({
      labels: [LABEL],
      headSha: HEAD,
      reviews: [
        review("dante-human", HEAD),
        {
          ...review("dante-human", HEAD, "CHANGES_REQUESTED"),
          submitted_at: "2026-11-20T11:00:00Z",
        },
      ],
    });
    expect(result.allowed).toBe(false);
  });

  it("envFlagNeverGrantsInsideGitHubActions", () => {
    const result = grant(
      { labels: [], headSha: HEAD, reviews: [] },
      { POLICY_CHANGE_APPROVED: "1" },
    );
    expect(result.allowed).toBe(false);
  });

  it("failsClosedWhenTheApiCannotBeRead", () => {
    const result = resolveHumanGrant({
      label: LABEL,
      envFlag: "POLICY_CHANGE_APPROVED",
      env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: REPO, GITHUB_EVENT_PATH: prEvent() },
      fetchJson: () => {
        throw new Error("HTTP 403");
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("fail closed");
    const noToken = resolveHumanGrant({
      label: LABEL,
      envFlag: "POLICY_CHANGE_APPROVED",
      env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: REPO, GITHUB_EVENT_PATH: prEvent() },
    });
    expect(noToken.allowed).toBe(false);
  });

  it("pushUsesTheMergedPrAndDirectPushHasNoGrant", () => {
    const dir = mkdtempSync(join(tmpdir(), "app-identity-2-push-"));
    temps.push(dir);
    const event = join(dir, "push.json");
    writeFileSync(event, JSON.stringify({ before: OLD, after: "c".repeat(40) }));
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_PATH: event,
      GITHUB_SHA: "c".repeat(40),
      GAUNTLET_SHARED_TOKEN_LOGINS: "none",
    };
    const merged: GitHubFetch = (path) => {
      if (path.endsWith("/pulls")) {
        return [
          {
            number: 7,
            merged_at: "2026-11-20T12:00:00Z",
            merge_commit_sha: "c".repeat(40),
            head: { sha: HEAD },
          },
        ];
      }
      if (path === `/repos/${REPO}/pulls/7`) {
        return {
          number: 7,
          merged_at: "2026-11-20T12:00:00Z",
          head: { sha: HEAD },
          labels: [{ name: LABEL }],
        };
      }
      return path.includes("page=1") ? [review("dante-human", HEAD)] : [];
    };
    expect(resolveHumanGrant({ label: LABEL, envFlag: "X", env, fetchJson: merged }).allowed).toBe(
      true,
    );
    const direct: GitHubFetch = () => [];
    const none = resolveHumanGrant({ label: LABEL, envFlag: "X", env, fetchJson: direct });
    expect(none.allowed).toBe(false);
    expect(none.reason).toContain("direct push has no grant");
  });

  it("localRunHonoursOnlyTheEnvFlag", () => {
    const base = { label: LABEL, envFlag: "POLICY_CHANGE_APPROVED" };
    expect(resolveHumanGrant({ ...base, env: { POLICY_CHANGE_APPROVED: "1" } }).allowed).toBe(true);
    expect(resolveHumanGrant({ ...base, env: { GITHUB_EVENT_PATH: prEvent() } }).allowed).toBe(
      false,
    );
  });
});
