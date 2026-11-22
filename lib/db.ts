import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { SCHEMA, migrateTaskColumns } from "@lilboard/core";
import { nodeSql } from "@lilboard/core/node";
import { LIST_SCHEMA } from "./list-schema";

const dataDir = process.env.LILBOARD_DATA ?? path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

// During `next build`, page-data collection imports route modules in
// parallel workers — all would open (and seed) the same SQLite file.
// Use an ephemeral in-memory DB for the build phase; runtime is unaffected.
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

export const db = new DatabaseSync(
  isBuild ? ":memory:" : path.join(dataDir, "lilboard.db")
);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(SCHEMA);
migrateTaskColumns(nodeSql(db));
db.exec(LIST_SCHEMA);
// actors is a Node-runtime concern (tokens hashed from env); the Worker
// authenticates from env before the request reaches the Durable Object.
db.exec(`
CREATE TABLE IF NOT EXISTS actors (
  name TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agent'
);
`);

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Tokens are 64 hex chars (openssl rand -hex 32) — same convention as
// lilvault. Invalid tokens fail loudly at startup, not silently at auth.
const validToken = (t: string) => /^[0-9a-f]{64}$/.test(t);
const insert = db.prepare(
  "INSERT OR IGNORE INTO actors (name, token_hash, kind) VALUES (?, ?, ?)"
);
function seedActor(name: string, token: string, kind: string) {
  if (!validToken(token)) {
    throw new Error(
      `LILBOARD token for ${name} must be 64 hex chars (openssl rand -hex 32)`
    );
  }
  insert.run(name, hashToken(token), kind);
}

// Seed from a lilvault-style keys dir (LILBOARD_KEYS_DIR): one token file
// per actor — <name>.token, <name>.person.token, or <name>.admin.token
// (admins can mint and revoke tokens via /api/auth/agents).
const keysDir = process.env.LILBOARD_KEYS_DIR;
if (keysDir) {
  for (const f of fs.readdirSync(keysDir)) {
    const m = /^(.+?)\.(person\.|admin\.)?token$/.exec(f);
    if (m) {
      seedActor(
        m[1],
        fs.readFileSync(path.join(keysDir, f), "utf8").trim(),
        m[2] ? m[2].replace(".", "") : "agent"
      );
    }
  }
}

// Env seeding stays for bootstrapping (and is the Worker's only source):
// LILBOARD_TOKENS="fx=<64hex>,ada=<64hex>:person" — kind defaults to agent.
const seed = process.env.LILBOARD_TOKENS ?? "";
for (const pair of seed.split(",").map((s) => s.trim()).filter(Boolean)) {
  const [name, rest] = pair.split("=");
  const [token, kind] = (rest ?? "").split(":");
  if (name && token) seedActor(name.trim(), token.trim(), kind?.trim() || "agent");
}

export const DEFAULT_BOARD = process.env.LILBOARD_BOARD ?? "general";
