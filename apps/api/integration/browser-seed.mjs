import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

// Only the isolated ci:e2e database. Invitation tokens are synthetic and never logged.
export async function seedBrowserInvitations(dev, env) {
  if (env.NODE_ENV !== "test" || env.DB_NAME !== "oliginvest_dev")
    throw new Error("Isolated browser database required");
  const client = new pg.Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: "postgres",
    password: dev.DEV_POSTGRES_PASSWORD,
  });
  await client.connect();
  try {
    const owner = (
      await client.query("SELECT id FROM auth.users WHERE email=$1", ["dev@example.invalid"])
    ).rows[0];
    if (!owner) throw new Error("Synthetic seed owner missing");
    const fixtures = {};
    for (const browser of ["chromium", "firefox", "webkit"]) {
      const token = randomBytes(32).toString("base64url");
      const email = `${browser}@browser.example.test`;
      await client.query(
        "INSERT INTO identity.invitations(email,role,token_hash,invited_by,expires_at) VALUES($1,'user',$2,$3,now()+interval '1 hour')",
        [email, createHash("sha256").update(token).digest("hex"), owner.id],
      );
      fixtures[browser] = { token, email, password: randomBytes(24).toString("hex") };
    }
    for (const [symbol, ticker, currency, mic] of [
      ["AAPL.US", "AAPL", "USD", "XNAS"],
      ["PKO.PL", "PKO", "PLN", "XWAR"],
      ["VWCE.DE", "VWCE", "EUR", "XETR"],
    ]) {
      let instrument = (
        await client.query("SELECT id FROM market.instruments WHERE ticker=$1 AND mic=$2", [
          ticker,
          mic,
        ])
      ).rows[0];
      if (!instrument)
        instrument = (
          await client.query(
            "INSERT INTO market.instruments(ticker,mic,name,type,currency) VALUES($1,$2,$1,'stock',$3) RETURNING id",
            [ticker, mic, currency],
          )
        ).rows[0];
      await client.query(
        "INSERT INTO market.instrument_provider_symbols(provider,symbol,instrument_id) VALUES('xtb',$1,$2) ON CONFLICT(provider,symbol) DO NOTHING",
        [symbol, instrument.id],
      );
    }
    return fixtures;
  } finally {
    await client.end();
  }
}
