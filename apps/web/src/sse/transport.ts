export type Frame = { event: string; data: string; id?: string };
export function retryDelay(attempt: number, base = 5000, random = Math.random) {
  return Math.round(
    Math.min(60000, Math.max(1000, base) * 2 ** Math.min(attempt, 16)) * (0.5 + 0.5 * random()),
  );
}
export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  onFrame: (frame: Frame) => void | Promise<void>,
  onRetry: (ms: number) => void,
  onActivity: () => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [],
    event = "message",
    id: string | undefined;
  async function line(value: string) {
    onActivity();
    if (value === "") {
      if (data.length)
        await onFrame({ event, data: data.join("\n"), ...(id === undefined ? {} : { id }) });
      data = [];
      event = "message";
      id = undefined;
      return;
    }
    const colon = value.indexOf(":");
    const key = colon < 0 ? value : value.slice(0, colon);
    let text = colon < 0 ? "" : value.slice(colon + 1);
    if (text.startsWith(" ")) text = text.slice(1);
    if (key === "data") data.push(text);
    else if (key === "event") event = text;
    else if (key === "id" && !text.includes("\0")) id = text;
    else if (key === "retry" && /^\d+$/u.test(text))
      onRetry(Math.min(60000, Math.max(1000, Number(text))));
    if (data.join("\n").length > 262144) throw new Error("SSE_FRAME_LIMIT");
  }
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        if (buffer.endsWith("\r")) await line(buffer.slice(0, -1));
        break;
      }
      buffer += decoder.decode(part.value, { stream: true });
      if (buffer.length > 262144) throw new Error("SSE_BUFFER_LIMIT");
      for (;;) {
        const index = buffer.search(/[\r\n]/u);
        if (index < 0 || (buffer[index] === "\r" && index === buffer.length - 1)) break;
        const value = buffer.slice(0, index);
        const size = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
        buffer = buffer.slice(index + size);
        await line(value);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export type StreamState = "live" | "polling" | "paused" | "offline";
let activeStop: (() => void) | undefined;
export function connectStream(options: {
  frame: (frame: Frame) => Promise<void>;
  state: (state: StreamState) => void;
  unauthorized: () => void;
  resume: () => void;
  fetcher?: typeof fetch;
  initiallyPaused?: boolean;
}) {
  activeStop?.();
  let generation = 0;
  let stopped = false,
    paused = options.initiallyPaused ?? false,
    background = false,
    attempt = 0,
    base = 5000,
    lastId = "",
    failures: number[] = [],
    controller: AbortController | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  let lastActivity = Date.now();
  const schedule = (ms: number) => {
    clearTimeout(timer);
    if (!stopped && !paused && !background) timer = setTimeout(() => void open(), ms);
  };
  const abort = () => {
    generation++;
    clearTimeout(timer);
    controller?.abort();
  };
  async function open() {
    if (stopped || paused || background) return;
    const ticket = ++generation;
    controller = new AbortController();
    const current = controller;
    lastActivity = Date.now();
    let next: number | undefined;
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity >= 60000) current.abort();
    }, 5000);
    try {
      const response = await (options.fetcher ?? fetch)("/api/v1/stream", {
        headers: { Accept: "text/event-stream", ...(lastId ? { "Last-Event-ID": lastId } : {}) },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: current.signal,
      });
      if (ticket !== generation) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401 || response.status === 403) {
        stop();
        options.unauthorized();
        return;
      }
      if (response.status === 429) {
        await response.body?.cancel();
        options.state("polling");
        const value = response.headers.get("retry-after");
        const retry =
          value && /^\d+$/u.test(value)
            ? Number(value) * 1000
            : Date.parse(value ?? "") - Date.now();
        next = Number.isFinite(retry) ? Math.min(2147483647, Math.max(1000, retry)) : 300000;
        return;
      }
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("text/event-stream") ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new Error("SSE_UNAVAILABLE");
      }
      await parseStream(
        response.body,
        async (frame) => {
          if (ticket !== generation) return;
          await options.frame(frame);
          if (frame.id !== undefined && /^\d+-\d+$/u.test(frame.id)) lastId = frame.id;
          if (frame.event === "ready") {
            attempt = 0;
            failures = [];
            options.state("live");
          }
          if (frame.event === "auth.session.revoked") {
            stop();
            options.unauthorized();
          }
        },
        (ms) => {
          base = ms;
        },
        () => {
          lastActivity = Date.now();
        },
      );
    } catch {
      if (ticket === generation && !stopped && !paused && !background)
        options.state(navigator.onLine ? "polling" : "offline");
    } finally {
      clearInterval(watchdog);
      current.abort();
      if (ticket === generation && !stopped && !paused && !background) {
        failures = failures.filter((time) => Date.now() - time < 120000);
        failures.push(Date.now());
        if (failures.length >= 3) {
          options.state("polling");
          next ??= 300000;
        }
        schedule(next ?? retryDelay(attempt++, base));
      }
    }
  }
  const visibility = () => {
    clearTimeout(hiddenTimer);
    if (document.hidden) {
      hiddenTimer = setTimeout(() => {
        background = true;
        abort();
        options.state("paused");
      }, 300000);
    } else {
      options.resume();
      if (background) {
        background = false;
        if (!paused) schedule(0);
      }
    }
  };
  const online = () => {
    if (!paused && !background) {
      abort();
      schedule(0);
      options.resume();
    }
  };
  function stop() {
    stopped = true;
    abort();
    clearTimeout(hiddenTimer);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("online", online);
    if (activeStop === stop) activeStop = undefined;
  }
  activeStop = stop;
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("online", online);
  visibility();
  void open();
  return {
    stop,
    pause(value: boolean) {
      paused = value;
      abort();
      if (value) options.state("paused");
      else if (!background) {
        options.resume();
        schedule(0);
      }
    },
  };
}
