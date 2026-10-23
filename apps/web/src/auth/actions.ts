import type { ActionName } from "../api/validation";

export type ActionResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      code: string;
      requestId: string;
      seconds: string;
      errors: { path: string; message: string }[];
    };

// Session operations rotate or clear cookies and are followed by a document navigation.
// A Server Action would re-render the current route for the cookie change and start a second,
// competing router navigation; a plain same-origin request leaves exactly one navigation.
export async function submitAction(name: ActionName, input: unknown): Promise<ActionResult> {
  try {
    const response = await fetch("/auth/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, input }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    if (response.headers.get("content-type")?.includes("application/json"))
      return (await response.json()) as ActionResult;
  } catch {
    /* Reported below as an unavailable service. */
  }
  return { ok: false, code: "SERVICE_UNAVAILABLE", requestId: "", seconds: "60", errors: [] };
}
