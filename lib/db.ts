import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { SCHEMA } from "@lilboard/core";

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

// Seed actors from env: LILBOARD_TOKENS="fx=token1,ada=token2:person"
// suffix :person marks a human actor; default kind is agent.
const seed = process.env.LILBOARD_TOKENS ?? "";
const insert = db.prepare(
  "INSERT OR IGNORE INTO actors (name, token_hash, kind) VALUES (?, ?, ?)"
);
for (const pair of seed.split(",").map((s) => s.trim()).filter(Boolean)) {
  const [name, rest] = pair.split("=");
  const [token, kind] = (rest ?? "").split(":");
  if (name && token) insert.run(name.trim(), hashToken(token.trim()), kind?.trim() || "agent");
}

export const DEFAULT_BOARD = process.env.LILBOARD_BOARD ?? "general";
