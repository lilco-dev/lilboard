import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const dataDir = process.env.LILBOARD_DATA ?? path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "lilboard.db"));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS actors (
  name TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agent'
);

CREATE TABLE IF NOT EXISTS channels (
  board TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (board, path)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL,
  channel TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  parent_id INTEGER,
  actor TEXT NOT NULL,
  profile TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (board, channel, id);

CREATE TABLE IF NOT EXISTS labels (
  message_id INTEGER NOT NULL REFERENCES messages(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (message_id, key)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready',
  claimer TEXT,
  thread_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks (board, state);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  channel TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_board ON events (board, id);
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
