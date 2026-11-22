import { digest, need, positive, roles, sameScope } from "./evidence.mjs";

// Receipts come from the owner's durable authenticated, append-only feed, never from PR content.
// A recovery checkpoint is authoritative for the lifetime round count and both issuer watermarks.
export function replay(events, pr) {
  let state;
  for (const event of events) {
    need(event.pr === pr && positive(event.offset), "invalid journal entry");
    if (event.type === "checkpoint") {
      need(!state || event.offset > state.offset, "checkpoint rollback");
      need(
        Number.isSafeInteger(event.rounds) &&
          event.rounds >= (state?.rounds ?? 0) &&
          roles.every(
            (r) =>
              Number.isSafeInteger(event.sequences[r]) &&
              event.sequences[r] >= (state?.sequences[r] ?? 0),
          ),
        "invalid recovery checkpoint",
      );
      state = {
        ...event,
        generation: digest(event),
        sequences: { ...event.sequences },
        latest: {},
      };
      continue;
    }
    need(state && event.offset === state.offset + 1, "journal gap requires a new checkpoint");
    state.offset = event.offset;
    if (event.type === "verdict") {
      const v = JSON.parse(event.envelope.payload);
      need(
        roles.includes(v.role) && sameScope(v, state) && v.sequence === state.sequences[v.role] + 1,
        "invalid issuer sequence",
      );
      state.sequences[v.role] = v.sequence;
      state.latest[v.role] = digest(event.envelope);
      if (v.verdict === "GOTOWE") continue;
    } else {
      need(
        ["revision", "update-branch", "retry-ci", "revoke", "round"].includes(event.type),
        "unknown journal event",
      );
      if (event.type === "round") state.rounds++;
      if (["revision", "update-branch", "retry-ci"].includes(event.type))
        state.ciEpoch = event.ciEpoch;
      if (event.type === "revision" || event.type === "update-branch") {
        state.head = event.head;
        state.base = event.base;
      }
    }
    state.generation = digest([state.generation, event]);
    state.latest = {};
  }
  need(state, "empty journal");
  return state;
}
