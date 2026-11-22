import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ciEpoch } from "./collector-ci.mjs";
import {
  need,
  open,
  outside,
  positive,
  readExternal,
  registryFrom,
  requiredEnv,
} from "./evidence.mjs";
import { githubReader } from "./github.mjs";
import { replay } from "./journal.mjs";

// A dedicated, authenticated upstream consumer calls this with its durable delivery offset.
// The repository author has no path to this entry point on the owner's host.
export function recordOperation(directory, event, registry, expectedOffset) {
  need(positive(event.pr) && positive(event.offset), "invalid journal coordinates");
  const path = join(outside(directory), `${event.pr}.json`);
  const lock = openSync(`${path}.lock`, "wx", 0o600);
  try {
    const events = existsSync(path) ? JSON.parse(readExternal(path)) : [];
    need((events.at(-1)?.offset ?? 0) === expectedOffset, "journal cursor changed");
    if (event.type === "verdict") {
      const role = JSON.parse(event.envelope.payload).role;
      const signer = registry[role];
      need(signer, "unregistered issuer");
      const verdict = open(event.envelope, signer.key);
      need(
        verdict.provider === signer.provider && verdict.issuer === signer.id,
        "wrong journal issuer",
      );
    }
    events.push(event);
    const next = replay(events, event.pr);
    const temp = `${path}.next`;
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(events)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    return { offset: event.offset, generation: next.generation };
  } finally {
    closeSync(lock);
    unlinkSync(`${path}.lock`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readExternal(requiredEnv("GATE_JOURNAL_CONFIG")));
  const { event, expectedOffset } = JSON.parse(readFileSync(0, "utf8"));
  if (["checkpoint", "revision", "update-branch", "retry-ci"].includes(event.type)) {
    need(positive(event.pr), "invalid PR");
    const get = githubReader(),
      pull = await get(`/pulls/${event.pr}`);
    need(
      pull.base.ref === "main" && pull.head.repo.full_name === "Ipper18/OligInvest",
      "wrong PR origin",
    );
    event.head = pull.head.sha;
    event.base = pull.base.sha;
    event.ciEpoch = await ciEpoch(get, pull.head.sha, pull.merge_commit_sha);
  }
  const receipt = recordOperation(
    config.journalDirectory,
    event,
    registryFrom(config.registry),
    expectedOffset,
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
