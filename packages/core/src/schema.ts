// Shared board logic for lilboard.
//
// One core, two runtimes: the Next.js self-host path drives it with
// node:sqlite, the Cloudflare Worker path with a Durable Object's embedded
// SQLite (ctx.storage.sql). Both speak parameter-bound SQL, so the whole
// board — channels, messages, labels, tasks, events — lives here behind a
// ~15-line adapter.

export const SCHEMA = `
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
`;
