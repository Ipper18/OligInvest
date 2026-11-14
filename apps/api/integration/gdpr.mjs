import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import {
  ERASURE_REFERENCE_COLUMNS,
  eraseDueAccounts,
  PERSONAL_DATA_SCHEMAS,
  personalDataTables,
  processDataExport,
  reEraseRestoredAccounts,
  syncErasureFile,
} from "@oliginvest/mod-identity/jobs";
import { sql } from "drizzle-orm";
import { createApp } from "../dist/app.js";
import { AuditWriter } from "../dist/auth/audit.js";
import { GdprService } from "../dist/auth/gdpr-routes.js";
import { SecurityMonitor } from "../dist/auth/security-monitor.js";
import { AuthService } from "../dist/auth/service.js";
import { sessionCookie } from "../dist/auth/session.js";

/** Minimal reader for the export ZIP (central directory, deflate). */
function unzip(bytes) {
  const buffer = Buffer.from(bytes);
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < buffer.readUInt16LE(end + 10); index += 1) {
    const compressed = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    files.set(name, inflateRawSync(buffer.subarray(start, start + compressed)));
    cursor += 46 + nameLength;
  }
  return files;
}

/**
 * BL-114 (FR-07.09, NFR-11.02): GDPR export and erasure against PostgreSQL with FORCE RLS.
 * Synthetic users and data only (ADR-013); addresses from RFC 5737.
 */
export async function testGdpr(settings) {
  const connection = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAuthDatabase({ ...connection, password: settings.passwords.auth });
  const appDatabase = createAppDatabase({ ...connection, password: settings.passwords.app });
  const configuration = {
    origin: "https://example.test",
    secrets: [{ version: 1, value: randomBytes(32).toString("hex") }],
    trustedProxies: [],
    sendReset: async () => {},
  };
  const key = randomBytes(32).toString("hex");
  const pseudonym = (value) => createHmac("sha256", key).update(value).digest("hex");
  const audit = new AuditWriter(appDatabase, key);
  const mail = new Map();
  const jobs = [];
  const monitor = new SecurityMonitor({
    appDatabase,
    audit,
    origin: configuration.origin,
    notify: async (id, payload) => {
      mail.set(id, payload);
    },
  });
  const service = new AuthService({
    database,
    appDatabase,
    configuration,
    state: { limit: async () => {} },
    passwordChecks: { compromised: async () => false, unavailable() {} },
    audit,
    securityEvent: async () => {},
    securityMonitor: monitor,
    enqueueExport: async (job) => {
      jobs.push(job);
    },
    event: () => {},
  });
  const gdpr = new GdprService(service);
  const ids = { alice: randomUUID(), bob: randomUUID(), carol: randomUUID() };
  const tokens = Object.fromEntries(
    Object.keys(ids).map((name) => [name, randomBytes(32).toString("hex")]),
  );
  const marker = { alice: `alice-${randomUUID()}`, bob: `bob-${randomUUID()}` };
  const actor = (name) => ({ userId: ids[name], role: "user" });
  const client = { ip: "192.0.2.44", userAgent: "Synthetic GDPR agent" };
  const request = (name, method = "GET", path = "/api/v1/me/exports") =>
    new Request(configuration.origin + path, {
      method,
      headers: {
        origin: configuration.origin,
        cookie: sessionCookie(tokens[name], configuration, false).split(";")[0],
      },
    });
  const denied = (run, code) => assert.rejects(run, (error) => error.code === code);
  // `null` = now on the database clock (after every earlier transaction).
  const stepUp = (name, at = null) =>
    database.transaction((tx) =>
      tx.execute(
        sql`UPDATE auth.sessions SET mfa_verified_at=coalesce(${at}::timestamptz, clock_timestamp()) WHERE token=${tokens[name]}`,
      ),
    );
  const directory = await mkdtemp(join(tmpdir(), "oliginvest-erasure-"));
  try {
    // ── Catalog: every table with user_id cascades from auth.users (directly or through a
    //    composite FK chain) and no other column referencing an account can block erasure.
    const catalog = await appDatabase.transaction({ userId: null, role: "system" }, async (tx) => ({
      tables: await personalDataTables(tx),
      foreignKeys: (
        await tx.execute(sql`SELECT c.conrelid::regclass::text AS source,
              c.confrelid::regclass::text AS target, c.confdeltype AS action,
              (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) AS columns
            FROM pg_catalog.pg_constraint c WHERE c.contype = 'f'`)
      ).rows,
      uuidColumns: (
        await tx.execute(sql`SELECT n.nspname AS schema, t.relname AS table, a.attname AS column
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class t ON t.oid = a.attrelid AND t.relkind IN ('r', 'p')
            JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
            WHERE a.atttypid = 'uuid'::regtype AND a.attnum > 0 AND NOT a.attisdropped
              AND n.nspname IN (${sql.join(
                PERSONAL_DATA_SCHEMAS.map((schema) => sql`${schema}`),
                sql`, `,
              )})
              AND (a.attname LIKE '%\\_by' OR a.attname LIKE '%user\\_id%')`)
      ).rows,
    }));
    assert.ok(catalog.tables.length >= 30, "Catalog lists the user_id tables");
    const cascades = new Map();
    const cascadesFromUsers = (table, seen = new Set()) => {
      if (table === "auth.users") return true;
      if (cascades.has(table)) return cascades.get(table);
      if (seen.has(table)) return false;
      seen.add(table);
      const result = catalog.foreignKeys.some(
        (fk) =>
          fk.source === table &&
          fk.action === "c" &&
          fk.columns.includes("user_id") &&
          cascadesFromUsers(fk.target, seen),
      );
      cascades.set(table, result);
      return result;
    };
    for (const table of catalog.tables) {
      const name = `${table.schema}.${table.table}`;
      assert.ok(cascadesFromUsers(name), `${name}.user_id does not cascade from auth.users`);
    }
    for (const fk of catalog.foreignKeys.filter((fk) => fk.target === "auth.users"))
      assert.ok(
        fk.action === "c" || fk.action === "n",
        `${fk.source} (${fk.columns}) blocks account deletion`,
      );
    const referenced = new Set(
      catalog.foreignKeys.flatMap((fk) => fk.columns.map((column) => `${fk.source}.${column}`)),
    );
    const known = new Set([
      ...ERASURE_REFERENCE_COLUMNS.map((parts) => parts.join(".")),
      // Pseudonymized by identity.erase_account; erasure_log keeps the identifier on purpose.
      "platform.audit_log.actor_user_id",
      "platform.erasure_log.erased_user_id",
    ]);
    const unhandled = catalog.uuidColumns
      .map((row) => `${row.schema}.${row.table}.${row.column}`)
      .filter((column) => !referenced.has(column) && !known.has(column));
    assert.deepEqual(unhandled, [], "Account reference without FK or erasure handling");

    // ── Synthetic accounts and data.
    await database.transaction(async (tx) => {
      for (const [name, id] of Object.entries(ids)) {
        await tx.execute(sql`INSERT INTO auth.users(id,name,email,email_verified,two_factor_enabled)
          VALUES(${id}::uuid,${`Synthetic ${name}`},${`${name}-${id}@example.invalid`},true,true)`);
        await tx.execute(sql`INSERT INTO auth.sessions(token,user_id,expires_at,ip_address,mfa_verified_at,mfa_method)
          VALUES(${tokens[name]},${id}::uuid,now()+interval '1 day','192.0.2.9',now(),'totp')`);
      }
    });
    await service.recordConsents(ids.alice, false);
    await service.recordConsents(ids.bob, false);
    for (const name of ["alice", "bob"])
      await appDatabase.transaction(actor(name), async (tx) => {
        const account = (
          await tx.execute(sql`INSERT INTO portfolio.accounts(user_id,name,broker,currency)
            VALUES(${ids[name]}::uuid,${`=SUM(1) ${marker[name]}`},'demo','PLN') RETURNING id::text`)
        ).rows[0].id;
        await tx.execute(sql`INSERT INTO market.watchlists(user_id,name)
          VALUES(${ids[name]}::uuid,${`Watch ${marker[name]}`})`);
        const batch = (
          await tx.execute(sql`INSERT INTO portfolio.import_batches(user_id,account_id,source,file_name,file_sha256)
            VALUES(${ids[name]}::uuid,${account}::uuid,'generic','synthetic.csv',${randomUUID()}) RETURNING id::text`)
        ).rows[0].id;
        await tx.execute(sql`INSERT INTO portfolio.import_files(batch_id,user_id,content,content_type,size_bytes,expires_at)
          VALUES(${batch}::uuid,${ids[name]}::uuid,${Buffer.from(`date;amount\n2026-11-01;-12.50;${marker[name]}\n`)},
            'text/csv',64,now()+interval '90 days')`);
      });

    // ── Export: idempotent request, one active export, worker under the owner's RLS.
    const exportKey = randomUUID();
    await stepUp("alice", new Date(Date.now() - 16 * 60_000));
    await denied(
      () => gdpr.createExport(request("alice", "POST"), exportKey, client),
      "STEP_UP_REQUIRED",
    );
    await stepUp("alice");
    const first = await gdpr.createExport(request("alice", "POST"), exportKey, client);
    assert.equal(first.dto.status, "queued");
    assert.equal(first.replayed, false);
    const replay = await gdpr.createExport(request("alice", "POST"), exportKey, client);
    assert.equal(replay.dto.id, first.dto.id);
    assert.equal(replay.replayed, true);
    await denied(
      () => gdpr.createExport(request("alice", "POST"), randomUUID(), client),
      "CONFLICT",
    );
    assert.deepEqual(jobs[0], { v: 1, exportId: first.dto.id, userId: ids.alice });
    await denied(() => gdpr.getExport(request("bob"), first.dto.id), "NOT_FOUND");
    const processed = await processDataExport(appDatabase, jobs[0], {
      readme: (locale) => `Synthetic README ${locale}`,
    });
    assert.deepEqual(processed, { status: "ready", userId: ids.alice, exportId: first.dto.id });
    assert.equal(
      (await processDataExport(appDatabase, jobs[0], { readme: () => "" })).status,
      "skipped",
      "A repeated job does not rebuild the archive",
    );
    const ready = await gdpr.getExport(request("alice"), first.dto.id);
    assert.equal(ready.status, "ready");
    assert.ok(ready.sizeBytes > 0 && ready.expiresAt);
    await denied(() => gdpr.downloadExport(request("bob"), first.dto.id), "NOT_FOUND");

    const app = createApp({
      logger: { info() {}, warn() {}, error() {} },
      publicBaseUrl: configuration.origin,
      checks: {
        postgres: async () => {},
        valkeyQueue: async () => {},
        valkeyCache: async () => {},
      },
      auth: { service: () => service, clientIp: () => "192.0.2.44" },
    });
    const response = await app.request(
      request("alice", "GET", `/api/v1/me/exports/${first.dto.id}/download`),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(
      response.headers.get("content-disposition"),
      /^attachment; filename="oliginvest-export-\d{4}-\d{2}-\d{2}\.zip"$/u,
    );
    const archive = unzip(new Uint8Array(await response.arrayBuffer()));
    const everything = [...archive.values()].map((data) => data.toString("utf8")).join("\n");
    assert.ok(everything.includes(marker.alice), "Own data is exported");
    assert.ok(!everything.includes(marker.bob), "Another user's data never appears");
    assert.ok(!everything.includes(ids.bob), "Another user's identifier never appears");
    assert.ok(!everything.includes(tokens.alice), "Session tokens are not exported");
    assert.equal(archive.get("README.txt").toString("utf8"), "Synthetic README pl-PL");
    const data = JSON.parse(archive.get("data.json").toString("utf8"));
    assert.equal(data.userId, ids.alice);
    for (const table of catalog.tables)
      assert.ok(
        Object.hasOwn(data.datasets, `${table.schema}.${table.table}`),
        `Export misses ${table.schema}.${table.table}`,
      );
    assert.equal(data.datasets["auth.users"][0].email, `alice-${ids.alice}@example.invalid`);
    assert.equal(data.datasets["auth.sessions"].length, 1);
    assert.ok(data.datasets["identity.consent_events"].length >= 2, "Consent history exported");
    assert.ok(
      data.datasets["platform.audit_log"].some((row) => row.action === "identity.export_requested"),
    );
    const files = [...archive.keys()].filter((name) => name.startsWith("files/"));
    assert.equal(files.length, 1);
    assert.match(archive.get(files[0]).toString("utf8"), new RegExp(marker.alice, "u"));
    assert.match(
      archive.get("csv/portfolio.accounts.csv").toString("utf8"),
      new RegExp(`'=SUM\\(1\\) ${marker.alice}`, "u"),
      "CSV neutralizes formulas",
    );
    assert.equal(
      (await app.request(request("alice", "GET", `/api/v1/me/exports/${first.dto.id}/download`)))
        .status,
      404,
      "One download only",
    );
    assert.equal((await gdpr.getExport(request("alice"), first.dto.id)).status, "expired");

    // ── Mass-export rule (BL-110): a fresh step-up after the request is required to download.
    await appDatabase.transaction(actor("bob"), async (tx) => {
      for (let index = 0; index < 3; index += 1)
        await tx.execute(sql`INSERT INTO platform.audit_log(actor_user_id,actor_ref,actor_type,action,outcome)
          VALUES(${ids.bob}::uuid,${pseudonym(ids.bob)},'user','identity.export_requested','success')`);
      // A queued export older than an hour counts as lost, not as an active export.
      await tx.execute(sql`INSERT INTO identity.data_exports(user_id,status,created_at)
        VALUES(${ids.bob}::uuid,'queued',now()-interval '2 hours')`);
    });
    const bobExport = await gdpr.createExport(request("bob", "POST"), randomUUID(), client);
    const bobJob = jobs.find((job) => job.exportId === bobExport.dto.id);
    assert.equal(
      (await processDataExport(appDatabase, bobJob, { readme: () => "" })).status,
      "ready",
    );
    await denied(() => gdpr.downloadExport(request("bob"), bobExport.dto.id), "STEP_UP_REQUIRED");
    await stepUp("bob");
    const bobFile = unzip((await gdpr.downloadExport(request("bob"), bobExport.dto.id)).content);
    const bobText = [...bobFile.values()].map((value) => value.toString("utf8")).join("\n");
    assert.ok(bobText.includes(marker.bob) && !bobText.includes(marker.alice));
    const bobRows = await appDatabase.transaction(
      actor("bob"),
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT status, step_up_after IS NOT NULL AS gated FROM identity.data_exports ORDER BY created_at`,
          )
        ).rows,
    );
    assert.equal(bobRows[0].status, "failed", "Stale export marked failed");
    assert.deepEqual(bobRows[1], { status: "expired", gated: true });

    // ── Daily cap: 10 export requests in 24 h.
    await appDatabase.transaction(actor("alice"), async (tx) => {
      for (let index = 0; index < 9; index += 1)
        await tx.execute(
          sql`INSERT INTO identity.data_exports(user_id,status) VALUES(${ids.alice}::uuid,'expired')`,
        );
    });
    await denied(
      () => gdpr.createExport(request("alice", "POST"), randomUUID(), client),
      "RATE_LIMITED",
    );

    // ── Deletion: step-up, no terms gate, one active request, cancel, e-mails, /me.
    await denied(() => gdpr.getDeletion(request("carol")), "NOT_FOUND");
    await stepUp("alice", new Date(Date.now() - 16 * 60_000));
    await denied(() => gdpr.requestDeletion(request("alice", "POST"), client), "STEP_UP_REQUIRED");
    await stepUp("alice");
    const deletion = await gdpr.requestDeletion(request("alice", "POST"), client);
    const grace = Date.parse(deletion.scheduledFor) - Date.parse(deletion.requestedAt);
    assert.ok(Math.abs(grace - 14 * 86_400_000) < 5000, "14-day grace period");
    await denied(() => gdpr.requestDeletion(request("alice", "POST"), client), "CONFLICT");
    assert.equal((await gdpr.getDeletion(request("alice"))).id, deletion.id);
    assert.ok(mail.has(`security-deletion-${deletion.id}`));
    const me = await (await app.request(request("alice", "GET", "/api/v1/me"))).json();
    assert.equal(me.deletionScheduledFor, deletion.scheduledFor);
    await gdpr.cancelDeletion(request("alice", "DELETE"), client);
    assert.ok(mail.has(`security-deletion-cancelled-${deletion.id}`));
    await denied(() => gdpr.getDeletion(request("alice")), "NOT_FOUND");
    await denied(() => gdpr.cancelDeletion(request("alice", "DELETE"), client), "NOT_FOUND");
    const carolDeletion = await gdpr.requestDeletion(request("carol", "POST"), client);
    assert.ok(carolDeletion.id, "Rights do not require the current terms (Carol has none)");
    await gdpr.requestDeletion(request("alice", "POST"), client);

    // ── Erasure: nothing before the grace period ends; then cascade, pseudonym, references.
    assert.deepEqual(await eraseDueAccounts(appDatabase, pseudonym), []);
    await appDatabase.transaction(actor("alice"), (tx) =>
      tx.execute(sql`UPDATE identity.deletion_requests SET scheduled_for=now()-interval '1 minute'
        WHERE cancelled_at IS NULL`),
    );
    const flagKey = `synthetic.gdpr.${randomUUID()}`;
    const eventId = randomUUID();
    await appDatabase.transaction({ userId: null, role: "system" }, async (tx) => {
      await tx.execute(sql`INSERT INTO platform.feature_flags(key,description,rules,updated_by)
        VALUES(${flagKey},'Synthetic',${JSON.stringify({ users: [ids.alice, ids.bob] })}::jsonb,${ids.alice}::uuid)`);
      await tx.execute(sql`INSERT INTO market.calendar_events(id,type,event_date,title,source,created_by)
        VALUES(${eventId}::uuid,'other',current_date,'Synthetic','admin',${ids.alice}::uuid)`);
    });
    const erased = await eraseDueAccounts(appDatabase, pseudonym);
    assert.deepEqual(
      erased.map((record) => record.erasedUserId),
      [ids.alice],
    );
    assert.equal(
      await database.transaction(
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT count(*)::int AS n FROM auth.users WHERE id=${ids.alice}::uuid`,
            )
          ).rows[0].n,
      ),
      0,
    );
    const leftovers = await appDatabase.transaction(actor("alice"), async (tx) => {
      const found = [];
      for (const table of catalog.tables) {
        const row = (
          await tx.execute(
            sql`SELECT count(*)::int AS n FROM ${sql.identifier(table.schema)}.${sql.identifier(table.table)} WHERE user_id=${ids.alice}::uuid`,
          )
        ).rows[0];
        if (row.n) found.push(`${table.schema}.${table.table}`);
      }
      return found;
    });
    assert.deepEqual(leftovers, [], "Erasure leaves no row in any user_id table");
    const system = await appDatabase.transaction({ userId: null, role: "system" }, async (tx) => ({
      flag: (
        await tx.execute(
          sql`SELECT updated_by, rules FROM platform.feature_flags WHERE key=${flagKey}`,
        )
      ).rows[0],
      event: (
        await tx.execute(
          sql`SELECT created_by FROM market.calendar_events WHERE id=${eventId}::uuid`,
        )
      ).rows[0],
      log: (
        await tx.execute(
          sql`SELECT count(*)::int AS n FROM platform.erasure_log WHERE erased_user_id=${ids.alice}::uuid`,
        )
      ).rows[0].n,
    }));
    assert.equal(system.flag.updated_by, null);
    assert.deepEqual(system.flag.rules, { users: [ids.bob] });
    assert.equal(system.event.created_by, null);
    assert.equal(system.log, 1);
    const auditView = await appDatabase.transaction(
      { userId: randomUUID(), role: "admin" },
      async (tx) =>
        (
          await tx.execute(sql`SELECT actor_user_id, host(ip) AS ip, user_agent, resource_id, action
            FROM platform.audit_log WHERE actor_ref=${pseudonym(ids.alice)} OR resource_id=${pseudonym(ids.alice)}`)
        ).rows,
    );
    assert.ok(auditView.length >= 3, "Audit history stays under the pseudonym");
    assert.ok(auditView.every((row) => row.actor_user_id === null && row.ip === null));
    assert.ok(auditView.some((row) => row.action === "identity.account_erased"));
    const bobLeft = await appDatabase.transaction(
      actor("bob"),
      async (tx) =>
        (await tx.execute(sql`SELECT count(*)::int AS n FROM portfolio.accounts`)).rows[0].n,
    );
    assert.equal(bobLeft, 1, "Other accounts are untouched");

    // ── File outside the database and re-erasure after a restore (backup-dr.md § 7).
    const file = join(directory, "erasure-log.jsonl");
    await writeFile(file, "");
    const synced = await syncErasureFile(appDatabase, file);
    assert.ok(synced.appended >= 1);
    assert.match(await readFile(file, "utf8"), new RegExp(ids.alice, "u"));
    // Simulated restore: the account is back and the table no longer lists it.
    await appDatabase.transaction({ userId: null, role: "system" }, (tx) =>
      tx.execute(sql`DELETE FROM platform.erasure_log WHERE erased_user_id=${ids.alice}::uuid`),
    );
    await database.transaction((tx) =>
      tx.execute(sql`INSERT INTO auth.users(id,name,email,email_verified,two_factor_enabled)
        VALUES(${ids.alice}::uuid,'Synthetic restored',${`restored-${ids.alice}@example.invalid`},true,true)`),
    );
    const restored = await syncErasureFile(appDatabase, file);
    assert.ok(restored.unrecorded.includes(ids.alice));
    assert.equal(await reEraseRestoredAccounts(appDatabase, restored.unrecorded), 1);
    assert.deepEqual(
      (await eraseDueAccounts(appDatabase, pseudonym))
        .map((record) => record.erasedUserId)
        .filter((id) => id === ids.alice),
      [ids.alice],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await database.transaction((tx) =>
      tx.execute(
        sql`DELETE FROM auth.users WHERE id IN (${ids.alice}::uuid, ${ids.bob}::uuid, ${ids.carol}::uuid)`,
      ),
    );
    await appDatabase.transaction({ userId: null, role: "system" }, async (tx) => {
      await tx.execute(sql`DELETE FROM platform.feature_flags WHERE key LIKE 'synthetic.gdpr.%'`);
      await tx.execute(
        sql`DELETE FROM market.calendar_events WHERE title='Synthetic' AND source='admin'`,
      );
    });
    await Promise.all([database.close(), appDatabase.close()]);
  }
}
