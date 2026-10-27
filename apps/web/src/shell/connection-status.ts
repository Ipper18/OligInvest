import type { StreamState } from "../sse/transport";

export type ConnectionStatus = StreamState | "connecting";

/**
 * The status shown next to the pause/resume button. The user's choice decides "paused"; a stream
 * that is paused for any other reason (not yet connected, background tab) is still connecting.
 */
export function connectionStatus(state: StreamState, paused: boolean): ConnectionStatus {
  if (paused) return "paused";
  return state === "paused" ? "connecting" : state;
}
