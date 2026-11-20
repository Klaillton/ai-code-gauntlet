/**
 * app-identity-2 — a human grant is an APPROVED review by the repo OWNER on the exact head SHA.
 *
 * Design closed by Gate with Challenge (2026-11-05, lote de 11/11):
 * 1. Grant = review APPROVED on the exact head SHA, from a login that is neither the
 *    agents' GitHub App nor another known agent, and whose review `author_association` is
 *    `OWNER` (Gate review 2026-11-20: on a public repo any account can leave an APPROVED review;
 *    NONE / CONTRIBUTOR / COLLABORATOR / missing never grant).
 * 2. While a human's token is shared with agents (`GAUNTLET_SHARED_TOKEN_LOGINS`), a review
 *    from that login FAILs with reason "human-unattributed". After the token is revoked
 *    (login removed from the list), the same review passes.
 * 3. A review on an older SHA does not count, even if GitHub did not dismiss it.
 * 4. Approved review followed by a new commit = FAIL.
 * 5. Label without review = FAIL. Review from the App = FAIL. No label and no review = FAIL.
 *
 * The label stays as the intent signal that names WHICH grant is asked for
 * (policy-change-approved, deps-approved, specs-approved, holes-approved,
 * spec-sync-approved); it never grants on its own.
 *
 * Modes:
 * - GitHub Actions (`GITHUB_ACTIONS=true`): the only grant is the review read live from the
 *   GitHub API (PR, labels, reviews). Env flags such as `ALLOW_DEPS_EDIT=1` are ignored.
 *   Any API error, missing token or missing PR context fails closed.
 * - Local run (no `GITHUB_ACTIONS`): the env flag is the local fast-check grant. A local run
 *   is never authoritative; CI is.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

export type HumanGrant = { allowed: boolean; reason: string };

export type ReviewRecord = {
  id?: number;
  user?: { login?: string; type?: string } | null;
  /** From the reviews API. Only OWNER can grant; missing = no grant (fail closed). */
  author_association?: string | null;
  state?: string;
  commit_id?: string | null;
  submitted_at?: string | null;
};

export type ReviewGrantInput = {
  /** Label naming the grant asked for (intent only). */
  label: string;
  /** Labels on the PR, read live. */
  labels: readonly string[];
  /** Head SHA this run evaluates (event head / --head). */
  headSha: string;
  /** Head SHA of the PR read live from the API. */
  liveHeadSha: string;
  reviews: readonly ReviewRecord[];
  /** Extra agent logins (case-insensitive). Any `*[bot]` / type Bot is always an agent. */
  agentLogins?: readonly string[];
  /** Human logins whose token is shared with agents: their reviews are human-unattributed. */
  sharedTokenLogins?: readonly string[];
};

export const DEFAULT_AGENT_LOGINS: readonly string[] = ["klaillton-gauntlet-agents[bot]"];
export const SHARED_TOKEN_LOGINS_ENV = "GAUNTLET_SHARED_TOKEN_LOGINS";
export const AGENT_LOGINS_ENV = "GAUNTLET_AGENT_LOGINS";
export const HUMAN_UNATTRIBUTED = "human-unattributed";
/** The only review author_association that can grant (repo owner). */
export const GRANTOR_ASSOCIATION = "OWNER";

/** Comma/space separated logins. `none` or `-` means an empty list. */
export function parseLogins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\s,]+/)
    .map((login) => login.trim())
    .filter((login) => login.length > 0 && login !== "none" && login !== "-");
}

function lower(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Review states that replace an earlier review from the same login. COMMENTED does not. */
const DECISIVE_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

function latestDecisiveByLogin(reviews: readonly ReviewRecord[]): Map<string, ReviewRecord> {
  const ordered = [...reviews].sort((a, b) => {
    const at = a.submitted_at ?? "";
    const bt = b.submitted_at ?? "";
    if (at !== bt) {
      return at < bt ? -1 : 1;
    }
    return (a.id ?? 0) - (b.id ?? 0);
  });
  const latest = new Map<string, ReviewRecord>();
  for (const review of ordered) {
    const login = review.user?.login;
    const state = (review.state ?? "").toUpperCase();
    if (!login || !DECISIVE_STATES.has(state)) {
      continue;
    }
    latest.set(login.toLowerCase(), review);
  }
  return latest;
}

export function isAgentReviewer(
  user: ReviewRecord["user"],
  agentLogins: readonly string[] = DEFAULT_AGENT_LOGINS,
): boolean {
  const login = user?.login ?? "";
  if (login.length === 0) {
    return true; // unknown reviewer never counts as human
  }
  if (user?.type === "Bot" || login.toLowerCase().endsWith("[bot]")) {
    return true;
  }
  return lower(agentLogins).has(login.toLowerCase());
}

/** Pure decision: does this PR state carry the human grant for `label`? */
export function evaluateReviewGrant(input: ReviewGrantInput): HumanGrant {
  const agents = [...DEFAULT_AGENT_LOGINS, ...(input.agentLogins ?? [])];
  const shared = lower(input.sharedTokenLogins ?? []);
  const hasLabel = input.labels.includes(input.label);
  if (!input.headSha || !input.liveHeadSha) {
    return {
      allowed: false,
      reason: `cannot resolve the PR head SHA (fail closed)`,
    };
  }
  if (input.headSha !== input.liveHeadSha) {
    return {
      allowed: false,
      reason:
        `head moved: this run checks ${shortSha(input.headSha)} but the PR head is ` +
        `${shortSha(input.liveHeadSha)}; a grant only counts on the exact current head`,
    };
  }
  const approvedOnHead: string[] = [];
  const approvedElsewhere: string[] = [];
  const agentApprovals: string[] = [];
  const unattributed: string[] = [];
  const nonOwnerApprovals: string[] = [];
  for (const [, review] of latestDecisiveByLogin(input.reviews)) {
    if ((review.state ?? "").toUpperCase() !== "APPROVED") {
      continue;
    }
    const login = review.user?.login ?? "?";
    if (isAgentReviewer(review.user, agents)) {
      agentApprovals.push(login);
      continue;
    }
    // Public repo: any GitHub account can leave an APPROVED review that the API returns even
    // though GitHub does not count it. Only the repo OWNER grants; missing association = no.
    const association = review.author_association ?? "";
    if (association !== GRANTOR_ASSOCIATION) {
      nonOwnerApprovals.push(`${login} (${association || "no author_association"})`);
      continue;
    }
    if (review.commit_id !== input.headSha) {
      approvedElsewhere.push(`${login}@${shortSha(review.commit_id ?? "")}`);
      continue;
    }
    if (shared.has(login.toLowerCase())) {
      unattributed.push(login);
      continue;
    }
    approvedOnHead.push(login);
  }
  if (!hasLabel) {
    return {
      allowed: false,
      reason: `label ${input.label} absent (the label names the grant; the review proves it)`,
    };
  }
  if (approvedOnHead.length > 0) {
    return {
      allowed: true,
      reason:
        `label ${input.label} + APPROVED review by ${approvedOnHead.join(", ")} ` +
        `on head ${shortSha(input.headSha)}`,
    };
  }
  if (unattributed.length > 0) {
    return {
      allowed: false,
      reason:
        `${HUMAN_UNATTRIBUTED}: review by ${unattributed.join(", ")} on ${shortSha(input.headSha)} ` +
        `does not count while that token is shared with agents (${SHARED_TOKEN_LOGINS_ENV})`,
    };
  }
  const notes: string[] = [];
  if (agentApprovals.length > 0) {
    notes.push(`agent reviews never grant (${agentApprovals.join(", ")})`);
  }
  if (nonOwnerApprovals.length > 0) {
    notes.push(`only the repo OWNER grants (${nonOwnerApprovals.join(", ")})`);
  }
  if (approvedElsewhere.length > 0) {
    notes.push(`approvals on other SHAs do not count (${approvedElsewhere.join(", ")})`);
  }
  return {
    allowed: false,
    reason:
      `label ${input.label} without a human APPROVED review on head ${shortSha(input.headSha)}` +
      (notes.length > 0 ? `; ${notes.join("; ")}` : ""),
  };
}

export type GitHubFetch = (path: string) => unknown;

type PullLike = {
  number?: number;
  head?: { sha?: string };
  labels?: { name?: string }[];
  merged_at?: string | null;
  merge_commit_sha?: string | null;
};

const FETCH_SCRIPT = `
const [url, auth] = [process.env.GG_URL, process.env.GG_AUTH];
const res = await fetch(url, { headers: {
  accept: "application/vnd.github+json",
  authorization: "Bearer " + auth,
  "x-github-api-version": "2022-11-28",
  "user-agent": "ai-code-gauntlet-human-grant",
} });
if (!res.ok) { console.error("HTTP " + res.status); process.exit(2); }
process.stdout.write(JSON.stringify(await res.json()));
`;

/** Synchronous GitHub GET (gates are synchronous). Throws on any failure. */
export function githubFetcher(env: NodeJS.ProcessEnv): GitHubFetch {
  const auth = env.GITHUB_TOKEN || env.GH_TOKEN;
  const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  return (path: string) => {
    if (!auth) {
      throw new Error("no GITHUB_TOKEN/GH_TOKEN to read reviews");
    }
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", FETCH_SCRIPT], {
      encoding: "utf8",
      env: { PATH: env.PATH ?? "", GG_URL: `${api}${path}`, GG_AUTH: auth },
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (run.status !== 0) {
      throw new Error(`GET ${path} failed: ${(run.stderr || run.error?.message || "").trim()}`);
    }
    return JSON.parse(run.stdout) as unknown;
  };
}

function readEventFile(env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function fetchAllReviews(fetchJson: GitHubFetch, repo: string, pr: number): ReviewRecord[] {
  const all: ReviewRecord[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = fetchJson(`/repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) {
      throw new Error("reviews API returned a non-array");
    }
    all.push(...(batch as ReviewRecord[]));
    if (batch.length < 100) {
      return all;
    }
  }
  throw new Error("more than 2000 reviews; refusing to guess (fail closed)");
}

type PrContext = { number: number; headSha: string } | { error: string };

function prContext(
  env: NodeJS.ProcessEnv,
  fetchJson: GitHubFetch,
  repo: string,
  headRef: string | undefined,
): PrContext {
  const event = readEventFile(env);
  if (!event) {
    return { error: "no GitHub event payload (fail closed)" };
  }
  const pull = event.pull_request as PullLike | undefined;
  if (pull?.number) {
    const headSha = headRef && /^[0-9a-f]{40}$/.test(headRef) ? headRef : (pull.head?.sha ?? "");
    return { number: pull.number, headSha };
  }
  // push: the grant is the PR that produced the pushed commit (none on a direct push).
  const sha = env.GITHUB_SHA ?? (event.after as string | undefined) ?? "";
  if (!sha) {
    return { error: "push without GITHUB_SHA (fail closed)" };
  }
  const pulls = fetchJson(`/repos/${repo}/commits/${sha}/pulls`);
  if (!Array.isArray(pulls)) {
    return { error: "commits/{sha}/pulls returned a non-array (fail closed)" };
  }
  const merged = (pulls as PullLike[]).filter((p) => p.merged_at && p.number);
  const exact = merged.filter((p) => p.merge_commit_sha === sha);
  const chosen = exact[0] ?? (merged.length === 1 ? merged[0] : undefined);
  if (!chosen?.number) {
    return {
      error: `no merged PR for pushed commit ${shortSha(sha)} (direct push has no grant)`,
    };
  }
  return { number: chosen.number, headSha: chosen.head?.sha ?? "" };
}

export type ResolveGrantOptions = {
  /** Label naming the grant (intent). */
  label: string;
  /** Env flag honoured only on local runs. */
  envFlag: string;
  env?: NodeJS.ProcessEnv;
  /** Head SHA under evaluation (policy-base --head). Defaults to the event head. */
  headRef?: string;
  /** Injected for tests; defaults to the live GitHub API. */
  fetchJson?: GitHubFetch;
};

export function isGitHubActions(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GITHUB_ACTIONS === "true";
}

const liveCache = new Map<string, HumanGrant>();

/** The human grant for one label: review on the exact head in CI, env flag locally. */
export function resolveHumanGrant(options: ResolveGrantOptions): HumanGrant {
  const env = options.env ?? process.env;
  if (isGitHubActions(env) && options.fetchJson === undefined) {
    // One live read per label/head per process: every gate asks for the policy grant.
    const key = [
      env[SHARED_TOKEN_LOGINS_ENV] ?? "",
      env[AGENT_LOGINS_ENV] ?? "",
      options.label,
      options.headRef ?? "",
      env.GITHUB_EVENT_PATH ?? "",
      env.GITHUB_SHA ?? "",
    ].join("|");
    const cached = liveCache.get(key);
    if (cached) {
      return cached;
    }
    const fresh = resolveLive(options, env);
    liveCache.set(key, fresh);
    return fresh;
  }
  return resolveLive(options, env);
}

function resolveLive(options: ResolveGrantOptions, env: NodeJS.ProcessEnv): HumanGrant {
  if (!isGitHubActions(env)) {
    if (env[options.envFlag] === "1") {
      return {
        allowed: true,
        reason: `${options.envFlag}=1 (local run only; CI needs the review)`,
      };
    }
    return { allowed: false, reason: `no local ${options.envFlag}=1 grant` };
  }
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) {
    return { allowed: false, reason: "GITHUB_REPOSITORY unset (fail closed)" };
  }
  const fetchJson = options.fetchJson ?? githubFetcher(env);
  try {
    const context = prContext(env, fetchJson, repo, options.headRef);
    if ("error" in context) {
      return { allowed: false, reason: context.error };
    }
    const live = fetchJson(`/repos/${repo}/pulls/${context.number}`) as PullLike;
    const labels = (live.labels ?? []).map((l) => l.name ?? "").filter((n) => n.length > 0);
    const reviews = fetchAllReviews(fetchJson, repo, context.number);
    const verdict = evaluateReviewGrant({
      label: options.label,
      labels,
      headSha: context.headSha,
      liveHeadSha: live.merged_at ? context.headSha : (live.head?.sha ?? ""),
      reviews,
      agentLogins: parseLogins(env[AGENT_LOGINS_ENV]),
      sharedTokenLogins: parseLogins(env[SHARED_TOKEN_LOGINS_ENV]),
    });
    return {
      allowed: verdict.allowed,
      reason: `PR #${context.number}: ${verdict.reason}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      allowed: false,
      reason: `cannot read the PR reviews (fail closed): ${message}`,
    };
  }
}
