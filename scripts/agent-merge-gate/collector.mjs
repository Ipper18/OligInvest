import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { ciEpoch, ciEvidence, codeqlEvidence } from "./collector-ci.mjs";
import {
  digest,
  need,
  positive,
  privateKey,
  repo,
  roles,
  sameScope,
  seal,
  seconds,
} from "./evidence.mjs";
import { assess, requiredContexts } from "./gate.mjs";
import { githubReader, pages } from "./github.mjs";
import { replay } from "./journal.mjs";

const rulesFile = new URL("../../.github/rulesets/main.json", import.meta.url);
const originalRules = JSON.parse(readFileSync(rulesFile, "utf8"));
function normalizedRules(rules) {
  return rules
    .map((rule) => {
      if (rule.type !== "required_status_checks") return rule;
      const checks = rule.parameters.required_status_checks
        .map((c) => {
          const copy = { ...c };
          if (copy.integration_id === null) delete copy.integration_id;
          return copy;
        })
        .sort((a, b) => a.context.localeCompare(b.context));
      return { ...rule, parameters: { ...rule.parameters, required_status_checks: checks } };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
}
async function checkRules(get, id, base) {
  need(positive(id), "missing ruleset pin");
  const source = await get(`/contents/.github/rulesets/main.json?ref=${base}`);
  need(source.encoding === "base64", "missing ruleset source");
  const pinned = JSON.parse(Buffer.from(source.content, "base64").toString("utf8"));
  need(isDeepStrictEqual(pinned, originalRules), "collector policy needs owner update");
  const actual = await get(`/rulesets/${id}`);
  const applied = await pages(get, "/rules/branches/main");
  need(
    applied.every(
      (r) =>
        r.ruleset_id === id && r.ruleset_source === repo && r.ruleset_source_type === "Repository",
    ),
    "unexpected effective ruleset",
  );
  const effective = applied.map((r) =>
    r.parameters ? { type: r.type, parameters: r.parameters } : { type: r.type },
  );
  need(
    isDeepStrictEqual(normalizedRules(effective), normalizedRules(pinned.rules)),
    "effective branch rule drift",
  );
  need(
    actual.id === id &&
      actual.source === repo &&
      actual.target === pinned.target &&
      actual.name === pinned.name &&
      actual.enforcement === "active" &&
      isDeepStrictEqual(actual.bypass_actors, []) &&
      isDeepStrictEqual(actual.conditions, pinned.conditions) &&
      isDeepStrictEqual(normalizedRules(actual.rules), normalizedRules(pinned.rules)) &&
      requiredContexts.length === 20,
    "ruleset drift",
  );
}
async function modes(get, sha) {
  const commit = await get(`/git/commits/${sha}`);
  need(commit.sha === sha && /^[a-f0-9]{40}$/.test(commit.tree.sha), "invalid commit tree");
  const tree = await get(`/git/trees/${commit.tree.sha}?recursive=1`);
  need(
    tree.sha === commit.tree.sha && tree.truncated === false && Array.isArray(tree.tree),
    "incomplete tree",
  );
  const entries = new Map(tree.tree.map((e) => [e.path, e]));
  need(entries.size === tree.tree.length, "ambiguous tree");
  return entries;
}
async function changedFiles(get, scope, expected) {
  need(positive(expected) && expected < 3000, "unsupported file count");
  const files = await pages(get, `/pulls/${scope.pr}/files`);
  need(
    files.length === expected && new Set(files.map((f) => f.filename)).size === expected,
    "incomplete file list",
  );
  const before = await modes(get, scope.base),
    after = await modes(get, scope.head);
  const listed = new Set(files.map((file) => file.filename));
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path),
      b = after.get(path);
    if (a?.type === "tree" && b?.type === "tree") continue;
    need(
      [a, b].every((e) => e && typeof e.sha === "string" && /^[0-9a-f]{40}$/.test(e.sha)),
      "incomplete object evidence",
    );
    const changed = a.sha !== b.sha || a.type !== b.type || a.mode !== b.mode;
    need(changed === listed.has(path), "tree and PR diff disagree");
  }
  return files.map((file) => {
    const left = before.get(file.filename),
      right = after.get(file.filename);
    need(
      left?.type === "blob" &&
        right?.type === "blob" &&
        left.mode === right.mode &&
        file.status === "modified" &&
        !file.previous_filename,
      "non-ordinary edit",
    );
    return {
      path: file.filename,
      status: file.status,
      beforeMode: left.mode,
      afterMode: right.mode,
    };
  });
}
// Owner-provided readJournal and readLatest read independent authenticated sources.
// This process receives public issuer keys only; key custody is an installation requirement.
export function collector({
  get = githubReader(),
  readJournal,
  readLatest,
  installedMain,
  pins,
  registry,
  key = privateKey("GATE_COLLECTOR_KEY"),
}) {
  const publicKey = createPublicKey(key);
  for (const role of roles) {
    need(
      registry[role].key.type === "public" && !publicKey.equals(registry[role].key),
      "collector/issuer key separation",
    );
  }
  async function current(pr) {
    need(positive(pr), "invalid PR");
    const pull = await get(`/pulls/${pr}`),
      main = await get("/git/ref/heads/main");
    const state = replay(await readJournal(pr), pr);
    need(
      pull.number === pr &&
        pull.base.repo.full_name === repo &&
        pull.head.repo.full_name === repo &&
        pull.base.ref === "main" &&
        pull.base.sha === main.object.sha &&
        state.base === main.object.sha &&
        installedMain === state.base &&
        state.head === pull.head.sha &&
        state.repo === repo &&
        state.githubAuthor === pull.user.login &&
        [state.base, state.head, pull.merge_commit_sha].every(
          (s) => typeof s === "string" && /^[a-f0-9]{40}$/.test(s),
        ),
      "revision or actor changed",
    );
    const observed = await ciEpoch(get, state.head, pull.merge_commit_sha);
    need(observed === state.ciEpoch, "journal has not acknowledged current CI attempts");
    const scope = { repo, pr, head: state.head, base: state.base, generation: state.generation };
    return {
      ...scope,
      state: pull.state.toUpperCase(),
      draft: pull.draft,
      mergeState: pull.mergeable_state.toUpperCase(),
      merge: pull.merge_commit_sha,
      branch: pull.base.ref,
      author: state.author,
      authorProvider: state.authorProvider,
      rounds: state.rounds,
      sequences: state.sequences,
      latest: state.latest,
      pins,
      changedFiles: pull.changed_files,
    };
  }
  async function latestReviews(pr) {
    return Promise.all(
      roles.map(async (role) => {
        const envelope = await readLatest(role, pr);
        need(envelope && typeof envelope.payload === "string", `missing ${role} verdict`);
        return envelope;
      }),
    );
  }
  async function decisionState(pr) {
    const latest = await latestReviews(pr);
    const fresh = await current(pr);
    need(
      roles.every((role, i) => fresh.latest[role] === digest(latest[i])),
      "issuer and journal disagree",
    );
    return fresh;
  }
  async function challenge(pr) {
    return seal({ ...(await current(pr)), kind: "issuer-challenge", issuedAt: seconds() }, key);
  }
  async function evaluate(pr) {
    const start = await current(pr);
    const { head, base, generation, merge, changedFiles: count } = start;
    const scope = { repo, pr, head, base, generation };
    const comparison = await get(`/compare/${base}...${head}`);
    need(
      comparison.merge_base_commit.sha === base && comparison.behind_by === 0,
      "branch behind main",
    );
    const synthetic = await get(`/git/commits/${merge}`);
    need(
      synthetic.sha === merge &&
        isDeepStrictEqual(
          synthetic.parents.map((p) => p.sha),
          [base, head],
        ),
      "wrong merge parents",
    );
    await checkRules(get, pins.rulesetId, base);
    const files = await changedFiles(get, scope, count);
    const ci = await ciEvidence(get, scope, pins, merge);
    const codeql = await codeqlEvidence(get, scope, merge, pins);
    const reviews = await latestReviews(pr);
    const proof = seal({ ...start, files, ci, codeql, reviews }, key);
    const fresh = await decisionState(pr);
    need(
      sameScope(start, fresh) && digest(start) === digest(fresh),
      "state changed during collection",
    );
    return { scope, proof, decision: assess(fresh, proof, publicKey, registry) };
  }
  async function reassess(result) {
    return assess(await decisionState(result.scope.pr), result.proof, publicKey, registry);
  }
  return { current, challenge, evaluate, reassess };
}
