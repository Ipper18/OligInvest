// Synthetic /api/v1/admin boundary (BL-112, BL-501, BL-509) for rendering, accessibility and
// performance only. Real role checks, step-up, audit and RLS are tested by apps/api/integration.
// State is kept per fixture session key, so parallel browsers never see each other's changes.
export const adminSelfId = "01900000-0000-7000-8000-000000000001";
export const adminUserId = "01900000-0000-7000-8000-000000000201";
const instant = "2026-10-13T12:00:00Z";
const later = "2027-01-01T00:00:00Z";
const page = (data) => ({ data, page: { hasMore: false } });

function seed() {
  const users = [
    {
      id: adminSelfId,
      email: "ui@example.test",
      name: "UI fixture",
      role: "admin",
      banned: false,
      twoFactorEnabled: true,
      emailVerified: true,
      createdAt: "2026-09-01T08:00:00Z",
      lastActiveAt: instant,
      activeSessions: 1,
    },
    {
      id: adminUserId,
      email: "alicja@example.test",
      name: "Alicja Syntetyczna",
      role: "user",
      banned: false,
      twoFactorEnabled: true,
      emailVerified: true,
      createdAt: "2026-09-02T08:00:00Z",
      lastActiveAt: instant,
      activeSessions: 2,
    },
    {
      id: "01900000-0000-7000-8000-000000000202",
      email: "bartek@example.test",
      name: "Bartek Syntetyczny",
      role: "pro",
      banned: true,
      banReason: "Syntetyczna blokada",
      banExpires: later,
      twoFactorEnabled: true,
      emailVerified: true,
      createdAt: "2026-09-03T08:00:00Z",
      activeSessions: 0,
    },
    {
      id: "01900000-0000-7000-8000-000000000203",
      email: "celina@example.test",
      name: "Celina Syntetyczna",
      role: "user",
      banned: false,
      twoFactorEnabled: true,
      emailVerified: true,
      createdAt: "2026-09-04T08:00:00Z",
      activeSessions: 0,
      deletionScheduledFor: "2026-10-27T12:00:00Z",
      deletionRequestedBy: "user",
    },
  ];
  const sessions = [
    {
      id: "01900000-0000-7000-8000-000000000301",
      userId: adminSelfId,
      userEmail: "ui@example.test",
      createdAt: instant,
      expiresAt: later,
      userAgent: "Synthetic browser",
      mfaVerifiedAt: instant,
    },
    ...["302", "303"].map((suffix) => ({
      id: `01900000-0000-7000-8000-000000000${suffix}`,
      userId: adminUserId,
      userEmail: "alicja@example.test",
      createdAt: instant,
      expiresAt: later,
      userAgent: "Synthetic browser",
      mfaVerifiedAt: instant,
    })),
  ];
  const invitations = [
    {
      id: "01900000-0000-7000-8000-000000000401",
      email: "nowy@example.test",
      role: "user",
      invitedBy: adminSelfId,
      status: "pending",
      expiresAt: later,
      createdAt: instant,
    },
    {
      id: "01900000-0000-7000-8000-000000000402",
      email: "stary@example.test",
      role: "pro",
      status: "used",
      expiresAt: "2026-09-10T08:00:00Z",
      usedAt: "2026-09-03T08:00:00Z",
      createdAt: "2026-09-02T08:00:00Z",
    },
  ];
  return { users, sessions, invitations, steppedUp: false };
}

const states = new Map();
const problem = (code, status) => ({
  type: "https://example.test/problems/admin",
  title: code,
  status,
  code,
});

export async function adminFixture(request, response, key, profile) {
  const url = new URL(request.url ?? "/", "https://example.test");
  const path = url.pathname;
  if (path !== "/api/v1/me/step-up" && !path.startsWith("/api/v1/admin/")) return false;
  const send = (value, status = 200) => {
    if (value === undefined) response.writeHead(status).end();
    else response.writeHead(status).end(JSON.stringify(value));
    return true;
  };
  if (!profile) return send(problem("UNAUTHENTICATED", 401), 401);
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = body ? JSON.parse(body) : {};
  if (!states.has(key)) states.set(key, seed());
  const state = states.get(key);
  if (path === "/api/v1/me/step-up") {
    if (request.method !== "POST" || input.code !== "123456")
      return send(problem("MFA_INVALID", 400), 400);
    state.steppedUp = true;
    return send({ validUntil: "2026-10-13T12:05:00Z" });
  }
  if (!key.startsWith("fixture-admin")) return send(problem("FORBIDDEN", 403), 403);
  const route = path.slice("/api/v1/admin".length);
  if (request.method !== "GET" && !state.steppedUp)
    return send(problem("STEP_UP_REQUIRED", 403), 403);

  const userMatch = /^\/users\/([\w-]+)(\/[\w-]+)?$/u.exec(route);
  if (route === "/users" && request.method === "GET") {
    const q = url.searchParams.get("q")?.toLowerCase();
    const role = url.searchParams.get("role");
    return send(
      page(
        state.users.filter(
          (user) =>
            (!q || `${user.email} ${user.name}`.toLowerCase().includes(q)) &&
            (!role || user.role === role),
        ),
      ),
    );
  }
  if (userMatch) {
    const user = state.users.find((entry) => entry.id === userMatch[1]);
    if (!user) return send(problem("NOT_FOUND", 404), 404);
    const action = userMatch[2];
    if (!action && request.method === "GET") return send(user);
    if (!action && request.method === "PATCH") {
      if (input.role) user.role = input.role;
      if (input.email) user.email = input.email;
      if (input.banned === true) {
        user.banned = true;
        user.banReason = input.banReason;
        if (input.banExpires) user.banExpires = input.banExpires;
      }
      if (input.banned === false) {
        user.banned = false;
        delete user.banReason;
        delete user.banExpires;
      }
      if (input.role || input.email || input.banned !== undefined) {
        user.activeSessions = 0;
        state.sessions = state.sessions.filter((session) => session.userId !== user.id);
      }
      return send(user);
    }
    if (!action && request.method === "DELETE") {
      if (user.deletionScheduledFor) return send(problem("CONFLICT", 409), 409);
      user.deletionScheduledFor = "2026-10-27T12:00:00Z";
      user.deletionRequestedBy = "admin";
      return send(
        {
          id: "01900000-0000-7000-8000-000000000501",
          status: "scheduled",
          requestedAt: instant,
          scheduledFor: user.deletionScheduledFor,
          requestedBy: "admin",
        },
        202,
      );
    }
    if (action === "/deletion-request" && request.method === "DELETE") {
      if (user.deletionRequestedBy !== "admin") return send(problem("NOT_FOUND", 404), 404);
      delete user.deletionScheduledFor;
      delete user.deletionRequestedBy;
      return send(undefined, 204);
    }
    if (action === "/reset-2fa" && request.method === "POST") {
      user.twoFactorEnabled = false;
      user.activeSessions = 0;
      state.sessions = state.sessions.filter((session) => session.userId !== user.id);
      return send(undefined, 204);
    }
    if (action === "/revoke-sessions" && request.method === "POST") {
      user.activeSessions = 0;
      state.sessions = state.sessions.filter((session) => session.userId !== user.id);
      return send(undefined, 204);
    }
  }
  if (route === "/sessions" && request.method === "GET") {
    const userId = url.searchParams.get("userId");
    return send(page(state.sessions.filter((session) => !userId || session.userId === userId)));
  }
  const sessionMatch = /^\/sessions\/([\w-]+)$/u.exec(route);
  if (sessionMatch && request.method === "DELETE") {
    const session = state.sessions.find((entry) => entry.id === sessionMatch[1]);
    if (!session) return send(problem("NOT_FOUND", 404), 404);
    state.sessions = state.sessions.filter((entry) => entry !== session);
    const owner = state.users.find((user) => user.id === session.userId);
    if (owner) owner.activeSessions = Math.max(0, owner.activeSessions - 1);
    return send(undefined, 204);
  }
  if (route === "/invitations" && request.method === "GET") {
    const status = url.searchParams.get("status");
    return send(page(state.invitations.filter((entry) => !status || entry.status === status)));
  }
  if (route === "/invitations" && request.method === "POST") {
    const invitation = {
      id: `01900000-0000-7000-8000-${String(400 + state.invitations.length + 1).padStart(12, "0")}`,
      email: input.email,
      role: input.role,
      invitedBy: adminSelfId,
      status: "pending",
      expiresAt: later,
      createdAt: instant,
    };
    state.invitations.unshift(invitation);
    const origin = request.headers.origin ?? "https://example.test";
    return send({ ...invitation, inviteUrl: `${origin}/rejestracja#t=${"s".repeat(43)}` }, 201);
  }
  const invitationMatch = /^\/invitations\/([\w-]+)$/u.exec(route);
  if (invitationMatch && request.method === "DELETE") {
    const invitation = state.invitations.find((entry) => entry.id === invitationMatch[1]);
    if (!invitation) return send(problem("NOT_FOUND", 404), 404);
    if (invitation.status !== "pending") return send(problem("CONFLICT", 409), 409);
    invitation.status = "revoked";
    invitation.revokedAt = instant;
    return send(undefined, 204);
  }
  return send(problem("NOT_FOUND", 404), 404);
}
