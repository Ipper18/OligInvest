import type {
  AdminInvitation,
  AdminSession,
  AdminUser as AdminUserDto,
} from "@oliginvest/contracts";
import { createFormatters, messages as defaultMessages, formatMessage } from "@oliginvest/i18n";
import type { AdminMessages } from "@oliginvest/i18n/admin";
import { Panel } from "@oliginvest/ui";
import { getLocalization } from "@oliginvest/ui/localization-server";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./admin.module.css";
import { InvitationForm, RowAction, UserActions } from "./admin-actions";
import {
  invitationsQuery,
  readInvitations,
  readSessions,
  readUser,
  readUsers,
  requireAdmin,
  sessionsQuery,
  usersQuery,
} from "./data";

/**
 * Administrator shell (BL-112, BL-501, BL-509; mapa-ekranow § admin). Server components: data
 * arrive through the audited API, nothing here can reach portfolio, transaction or analysis data.
 */
type Search = Promise<Record<string, string | string[] | undefined>>;
type Section = "overview" | "users" | "invitations" | "sessions";
const SECTIONS: readonly [Section, string][] = [
  ["overview", "/admin"],
  ["users", "/admin/uzytkownicy"],
  ["invitations", "/admin/zaproszenia"],
  ["sessions", "/admin/sesje"],
];

function Shell({
  m,
  current,
  title,
  intro,
  children,
}: {
  m: AdminMessages;
  current: Section;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.screen}>
      <h1>{title}</h1>
      <p>{intro}</p>
      <nav aria-label={m.sectionsLabel} className={styles.tabs}>
        {SECTIONS.map(([section, href]) => (
          <Link key={section} href={href} aria-current={section === current ? "page" : undefined}>
            {m.sections[section]}
          </Link>
        ))}
      </nav>
      <p className={styles.notice}>{m.noFinancialData}</p>
      {children}
    </section>
  );
}

function Table({
  caption,
  head,
  children,
}: {
  caption: string;
  head: string[];
  children: ReactNode;
}) {
  return (
    <section
      className="oi-table-scroll"
      aria-label={caption}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Horizontal scrolling at 360 px must be available from the keyboard, as in DataTable.
      tabIndex={0}
    >
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

function Paging({ m, show, children }: { m: AdminMessages; show: boolean; children: ReactNode }) {
  return show ? (
    <nav aria-label={m.pagingLabel} className={styles.paging}>
      {children}
    </nav>
  ) : null;
}

function userState(m: AdminMessages, user: AdminUserDto, date: (value: string) => string) {
  const parts = [
    user.banned
      ? user.banExpires
        ? formatMessage(m.state.blockedUntil, { date: date(user.banExpires) })
        : m.state.blocked
      : m.state.active,
  ];
  if (user.deletionScheduledFor)
    parts.push(
      `${formatMessage(m.state.deletion, { date: date(user.deletionScheduledFor) })} (${
        user.deletionRequestedBy === "admin" ? m.state.byAdmin : m.state.byUser
      })`,
    );
  return parts.join(" · ");
}
const nextHref = (base: string, params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return `${base}?${query.toString()}`;
};

export async function adminMetadata() {
  const { m } = await requireAdmin();
  const brand =
    ((await getLocalization()).copies.messages as typeof defaultMessages | undefined)?.app.brand ??
    defaultMessages.app.brand;
  return { title: `${m.title} — ${brand}` };
}

export async function AdminOverview() {
  const { m } = await requireAdmin();
  return (
    <Shell m={m} current="overview" title={m.title} intro={m.intro}>
      <ul className={styles.cards}>
        {SECTIONS.slice(1).map(([section, href]) => (
          <li key={section}>
            <Panel>
              <h2>
                <Link href={href}>{m.sections[section]}</Link>
              </h2>
              <p>
                {section === "users"
                  ? m.usersIntro
                  : section === "invitations"
                    ? m.invitationsIntro
                    : m.sessionsIntro}
              </p>
            </Panel>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

export async function AdminUsers({ searchParams }: { searchParams: Search }) {
  const { m, localization } = await requireAdmin();
  const { formatDateTime } = createFormatters(localization);
  const query = usersQuery(await searchParams);
  const page = await readUsers(query);
  return (
    <Shell m={m} current="users" title={m.sections.users} intro={m.usersIntro}>
      <Panel>
        <form method="get" className={styles.filters}>
          <div className="oi-field">
            <label htmlFor="admin-users-q">{m.search}</label>
            <input
              id="admin-users-q"
              name="q"
              type="search"
              className="oi-input"
              maxLength={64}
              defaultValue={query.q ?? ""}
            />
          </div>
          <div className="oi-field">
            <label htmlFor="admin-users-role">{m.roleFilter}</label>
            <select
              id="admin-users-role"
              name="role"
              className="oi-input"
              defaultValue={query.role ?? ""}
            >
              <option value="">{m.any}</option>
              {(["user", "pro", "admin"] as const).map((role) => (
                <option key={role} value={role}>
                  {m.roles[role]}
                </option>
              ))}
            </select>
          </div>
          <div className="oi-actions">
            <button type="submit" className="oi-button">
              {m.filter}
            </button>
          </div>
        </form>
        {page.data.length ? (
          <Table
            caption={m.sections.users}
            head={[
              m.columns.email,
              m.columns.name,
              m.columns.role,
              m.columns.twoFactor,
              m.columns.status,
              m.columns.lastActive,
              m.columns.sessions,
            ]}
          >
            {page.data.map((user) => (
              <tr key={user.id}>
                <td>
                  <Link href={`/admin/uzytkownicy/${user.id}`}>{user.email}</Link>
                </td>
                <td>{user.name}</td>
                <td>{m.roles[user.role]}</td>
                <td>{user.twoFactorEnabled ? m.yes : m.no}</td>
                <td>{userState(m, user, formatDateTime)}</td>
                <td>{user.lastActiveAt ? formatDateTime(user.lastActiveAt) : m.none}</td>
                <td className="num">{user.activeSessions}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p>{m.empty}</p>
        )}
        <Paging m={m} show={Boolean(query.cursor || page.page.nextCursor)}>
          {query.cursor && (
            <Link href={nextHref("/admin/uzytkownicy", { q: query.q, role: query.role })}>
              {m.first}
            </Link>
          )}
          {page.page.nextCursor && (
            <Link
              href={nextHref("/admin/uzytkownicy", {
                q: query.q,
                role: query.role,
                cursor: page.page.nextCursor,
              })}
            >
              {m.next}
            </Link>
          )}
        </Paging>
      </Panel>
    </Shell>
  );
}

function SessionRows({
  m,
  sessions,
  date,
  withEmail,
}: {
  m: AdminMessages;
  sessions: AdminSession[];
  date: (value: string) => string;
  withEmail: boolean;
}) {
  return sessions.map((session) => (
    <tr key={session.id}>
      {withEmail && (
        <td>
          <Link href={`/admin/uzytkownicy/${session.userId}`}>{session.userEmail}</Link>
        </td>
      )}
      <td>{date(session.createdAt)}</td>
      <td>{date(session.expiresAt)}</td>
      <td>{session.ipAddress ?? m.none}</td>
      <td className={styles.agent}>{session.userAgent ?? m.none}</td>
      <td>{session.mfaVerifiedAt ? date(session.mfaVerifiedAt) : m.none}</td>
      <td>
        <RowAction
          m={m}
          label={m.actions.revokeSession}
          confirmText={formatMessage(m.confirm.revokeSession, { email: session.userEmail })}
          request={{ op: "revokeSession", id: session.id }}
        />
      </td>
    </tr>
  ));
}
const sessionHead = (m: AdminMessages, withEmail: boolean) => [
  ...(withEmail ? [m.columns.email] : []),
  m.columns.createdAt,
  m.columns.expiresAt,
  m.columns.ip,
  m.columns.device,
  m.columns.mfaVerifiedAt,
  m.columns.actions,
];

export async function AdminUser({ params }: { params: Promise<{ userId: string }> }) {
  const { m, me, localization } = await requireAdmin();
  const { formatDateTime } = createFormatters(localization);
  const { user, sessions } = await readUser((await params).userId);
  const rows: [string, string][] = [
    [m.columns.email, user.email],
    [m.columns.name, user.name],
    [m.columns.role, m.roles[user.role]],
    [m.columns.status, userState(m, user, formatDateTime)],
    ...(user.banReason ? ([[m.banReason, user.banReason]] as [string, string][]) : []),
    [m.columns.createdAt, formatDateTime(user.createdAt)],
  ];
  const security: [string, string][] = [
    [m.columns.twoFactor, user.twoFactorEnabled ? m.yes : m.no],
    [m.emailVerified, user.emailVerified ? m.yes : m.no],
    [m.columns.lastActive, user.lastActiveAt ? formatDateTime(user.lastActiveAt) : m.none],
    [m.columns.sessions, String(user.activeSessions)],
  ];
  return (
    <Shell m={m} current="users" title={user.email} intro={m.usersIntro}>
      <p>
        <Link href="/admin/uzytkownicy">{m.back}</Link>
      </p>
      <div className={styles.columns}>
        <Panel>
          <h2>{m.account}</h2>
          <dl className={styles.facts}>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel>
          <h2>{m.security}</h2>
          <dl className={styles.facts}>
            {security.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      <Panel>
        <h2>{m.actionsHeading}</h2>
        <UserActions
          m={m}
          self={user.id === me.id}
          user={{
            id: user.id,
            email: user.email,
            role: user.role,
            banned: user.banned,
            deletionRequestedBy: user.deletionRequestedBy,
          }}
        />
      </Panel>
      <Panel>
        <h2>{m.sections.sessions}</h2>
        {sessions.data.length ? (
          <Table caption={m.sections.sessions} head={sessionHead(m, false)}>
            <SessionRows m={m} sessions={sessions.data} date={formatDateTime} withEmail={false} />
          </Table>
        ) : (
          <p>{m.empty}</p>
        )}
      </Panel>
    </Shell>
  );
}

export async function AdminInvitations({ searchParams }: { searchParams: Search }) {
  const { m, localization } = await requireAdmin();
  const { formatDateTime } = createFormatters(localization);
  const query = invitationsQuery(await searchParams);
  const page = await readInvitations(query);
  const statuses = ["pending", "used", "expired", "revoked"] as const;
  return (
    <Shell m={m} current="invitations" title={m.sections.invitations} intro={m.invitationsIntro}>
      <Panel>
        <h2>{m.actions.createInvitation}</h2>
        <InvitationForm m={m} />
      </Panel>
      <Panel>
        <form method="get" className={styles.filters}>
          <div className="oi-field">
            <label htmlFor="admin-invitations-status">{m.statusFilter}</label>
            <select
              id="admin-invitations-status"
              name="status"
              className="oi-input"
              defaultValue={query.status ?? ""}
            >
              <option value="">{m.any}</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {m.invitationStatus[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="oi-actions">
            <button type="submit" className="oi-button">
              {m.filter}
            </button>
          </div>
        </form>
        {page.data.length ? (
          <Table
            caption={m.sections.invitations}
            head={[
              m.columns.email,
              m.columns.role,
              m.columns.status,
              m.columns.createdAt,
              m.columns.expiresAt,
              m.columns.actions,
            ]}
          >
            {page.data.map((invitation: AdminInvitation) => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                <td>{m.roles[invitation.role]}</td>
                <td>{m.invitationStatus[invitation.status]}</td>
                <td>{formatDateTime(invitation.createdAt)}</td>
                <td>{formatDateTime(invitation.expiresAt)}</td>
                <td>
                  {invitation.status === "pending" || invitation.status === "expired" ? (
                    <RowAction
                      m={m}
                      label={m.actions.revokeInvitation}
                      confirmText={formatMessage(m.confirm.revokeInvitation, {
                        email: invitation.email,
                      })}
                      request={{ op: "revokeInvitation", id: invitation.id }}
                    />
                  ) : (
                    m.none
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p>{m.empty}</p>
        )}
        <Paging m={m} show={Boolean(page.page.nextCursor)}>
          {page.page.nextCursor && (
            <Link
              href={nextHref("/admin/zaproszenia", {
                status: query.status,
                cursor: page.page.nextCursor,
              })}
            >
              {m.next}
            </Link>
          )}
        </Paging>
      </Panel>
    </Shell>
  );
}

export async function AdminSessions({ searchParams }: { searchParams: Search }) {
  const { m, localization } = await requireAdmin();
  const { formatDateTime } = createFormatters(localization);
  const query = sessionsQuery(await searchParams);
  const page = await readSessions(query);
  return (
    <Shell m={m} current="sessions" title={m.sections.sessions} intro={m.sessionsIntro}>
      <Panel>
        {page.data.length ? (
          <Table caption={m.sections.sessions} head={sessionHead(m, true)}>
            <SessionRows m={m} sessions={page.data} date={formatDateTime} withEmail />
          </Table>
        ) : (
          <p>{m.empty}</p>
        )}
        <Paging m={m} show={Boolean(page.page.nextCursor)}>
          {page.page.nextCursor && (
            <Link href={nextHref("/admin/sesje", { cursor: page.page.nextCursor })}>{m.next}</Link>
          )}
        </Paging>
      </Panel>
    </Shell>
  );
}
