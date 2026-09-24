import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { afterEach, expect, test, vi } from "vitest";

const driver = vi.hoisted(() => ({ instances: [], connect: vi.fn(), query: vi.fn() }));
vi.mock("pg", () => ({
  default: {
    Client: class {
      constructor(options) {
        this.options = options;
        this.end = vi.fn(async () => {});
        this.on = vi.fn();
        driver.instances.push(this);
      }
      connect() {
        return driver.connect();
      }
      query(...args) {
        return driver.query(...args);
      }
    },
  },
}));
const { checkPostgres, checkValkey } = await import("../dist/probes.js");
afterEach(() => {
  vi.clearAllMocks();
  driver.instances.length = 0;
});

test("Postgres authenticates as the app role, runs SELECT 1 and closes", async () => {
  driver.connect.mockResolvedValue();
  driver.query.mockResolvedValue({ rows: [{ ok: 1 }] });
  await checkPostgres(
    {
      host: "localhost",
      port: 5432,
      database: "synthetic",
      password: randomBytes(16).toString("hex"),
      ssl: false,
    },
    100,
  );
  expect(driver.instances[0].options).toMatchObject({
    user: "oliginvest_app",
    options: "",
    connectionTimeoutMillis: 100,
  });
  expect(driver.query).toHaveBeenCalledWith("SELECT 1 AS ok");
  expect(driver.instances[0].end).toHaveBeenCalledOnce();
});

test.each(["connect", "query", "result", "timeout"])(
  "Postgres %s failure closes without leaking details",
  async (failure) => {
    driver.connect.mockImplementation(async () => {
      if (failure === "connect") throw new Error("private password");
    });
    driver.query.mockImplementation(async () => {
      if (failure === "query") throw new Error("private password");
      if (failure === "timeout") return new Promise(() => {});
      return { rows: [] };
    });
    await expect(
      checkPostgres(
        {
          host: "localhost",
          port: 5432,
          database: "synthetic",
          password: randomBytes(16).toString("hex"),
          ssl: false,
        },
        30,
      ),
    ).rejects.toThrow("Dependency unavailable");
    expect(driver.instances[0].end).toHaveBeenCalledOnce();
  },
);

async function peer(reply, work) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.once("data", (data) => reply(socket, data));
  });
  server.listen(0, "localhost");
  await once(server, "listening");
  try {
    await work(server.address().port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Valkey sends byte-counted AUTH and PING, accepts fragmented replies and disconnects", async () => {
  const password = `ż${randomBytes(16).toString("hex")}`;
  await peer(
    (socket, data) => {
      expect(data.toString()).toBe(
        `*3\r\n$4\r\nAUTH\r\n$3\r\napi\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n*1\r\n$4\r\nPING\r\n`,
      );
      socket.write("+O");
      setImmediate(() => socket.write("K\r\n+PONG\r\n"));
    },
    async (port) => {
      await checkValkey({ host: "localhost", port, user: "api", password }, 500);
    },
  );
});

test.each([
  "-WRONGPASS private password\r\n",
  "+OK\r\n-NOPERM private\r\n",
  "+OK\r\n+NOPE\r\n",
  "x".repeat(1024),
  null,
  "close",
])("Valkey rejects error, malformed, oversized, stalled or closed replies: %#", async (reply) => {
  await peer(
    (socket) => {
      if (reply === "close") socket.end();
      else if (reply !== null) socket.write(reply);
    },
    async (port) => {
      await expect(
        checkValkey(
          { host: "localhost", port, user: "default", password: randomBytes(16).toString("hex") },
          50,
        ),
      ).rejects.toThrow("Dependency unavailable");
    },
  );
});
