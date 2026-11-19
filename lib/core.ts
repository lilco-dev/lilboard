import { db, DEFAULT_BOARD } from "./db";

export type Actor = { actor: string; profile: string | null };

export type Message = {
  id: number;
  board: string;
  channel: string;
  thread_id: number;
  parent_id: number | null;
  actor: string;
  profile: string | null;
  display: string;
  body: string;
  labels: Record<string, string>;
  created_at: number;
};

export type Task = {
  id: number;
  board: string;
  channel: string;
  title: string;
  state: "ready" | "claimed" | "done";
  claimer: string | null;
  thread_id: number;
  created_at: number;
  updated_at: number;
};

const now = () => Date.now();

function emitEvent(board: string, kind: string, refId: number, channel?: string) {
  db.prepare("INSERT INTO events (board, kind, ref_id, channel, created_at) VALUES (?, ?, ?, ?, ?)").run(
    board,
    kind,
    refId,
    channel ?? null,
    now()
  );
  notify();
}

// --- long-poll notifier (single-node) ---
type Waiter = { board: string; since: number; resolve: () => void };
let waiters: Waiter[] = [];

function notify() {
  for (const w of waiters) w.resolve();
  waiters = [];
}

export function waitForEvents(board: string, since: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const w: Waiter = { board, since, resolve };
    waiters.push(w);
    const t = setTimeout(() => {
      waiters = waiters.filter((x) => x !== w);
      resolve();
    }, timeoutMs);
    const orig = resolve;
    w.resolve = () => {
      clearTimeout(t);
      orig();
    };
  });
}

export function hasEvents(board: string, since: number): boolean {
  const row = db
    .prepare("SELECT 1 FROM events WHERE board = ? AND id > ? LIMIT 1")
    .get(board, since) as { 1: number } | undefined;
  return !!row;
}

// --- channels / messages ---

export function ensureChannel(board: string, path: string) {
  db.prepare(
    "INSERT OR IGNORE INTO channels (board, path, created_at) VALUES (?, ?, ?)"
  ).run(board, path, now());
}

export function postMessage(opts: {
  board?: string;
  channel: string;
  body: string;
  actor: string;
  profile?: string | null;
  thread?: number | null;
  labels?: Record<string, string>;
}): Message {
  const board = opts.board ?? DEFAULT_BOARD;
  ensureChannel(board, opts.channel);
  const parent = opts.thread ?? null;
  const tx = db.prepare(
    `INSERT INTO messages (board, channel, thread_id, parent_id, actor, profile, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = tx.run(
    board,
    opts.channel,
    0, // placeholder, set thread_id = id for roots below
    parent,
    opts.actor,
    opts.profile ?? null,
    opts.body,
    now()
  );
  const id = Number(info.lastInsertRowid);
  const threadId = parent ?? id;
  db.prepare("UPDATE messages SET thread_id = ? WHERE id = ?").run(threadId, id);
  for (const [k, v] of Object.entries(opts.labels ?? {})) {
    db.prepare("INSERT OR REPLACE INTO labels (message_id, key, value) VALUES (?, ?, ?)").run(
      id,
      k,
      v
    );
  }
  emitEvent(board, "message", id, opts.channel);
  return getMessage(id)!;
}

export function getMessage(id: number): Message | null {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
    | (Record<string, unknown> & { id: number })
    | undefined;
  if (!row) return null;
  return decorate(row);
}

function decorate(row: Record<string, unknown> & { id: number }): Message {
  const labels: Record<string, string> = {};
  for (const l of db
    .prepare("SELECT key, value FROM labels WHERE message_id = ?")
    .all(row.id) as { key: string; value: string }[]) {
    labels[l.key] = l.value;
  }
  const profile = (row.profile as string | null) ?? null;
  const actor = row.actor as string;
  return {
    ...(row as unknown as Message),
    profile,
    display: profile && profile !== actor ? `${profile} via ${actor}` : actor,
    labels,
  };
}

export function listMessages(opts: {
  board?: string;
  channel: string;
  after?: number;
  limit?: number;
  label?: { key: string; value?: string };
}): Message[] {
  const board = opts.board ?? DEFAULT_BOARD;
  let sql = "SELECT m.* FROM messages m WHERE m.board = ? AND m.channel = ?";
  const args: unknown[] = [board, opts.channel];
  if (opts.after) {
    sql += " AND m.id > ?";
    args.push(opts.after);
  }
  if (opts.label) {
    sql += " AND EXISTS (SELECT 1 FROM labels l WHERE l.message_id = m.id AND l.key = ?";
    args.push(opts.label.key);
    if (opts.label.value !== undefined) {
      sql += " AND l.value = ?";
      args.push(opts.label.value);
    }
    sql += ")";
  }
  sql += " ORDER BY m.id LIMIT ?";
  args.push(opts.limit ?? 100);
  return (db.prepare(sql).all(...args) as (Record<string, unknown> & { id: number })[]).map(
    decorate
  );
}

export function listChannels(board?: string): { path: string; messages: number }[] {
  const b = board ?? DEFAULT_BOARD;
  return db
    .prepare(
      `SELECT c.path, COUNT(m.id) AS messages FROM channels c
       LEFT JOIN messages m ON m.board = c.board AND m.channel = c.path
       WHERE c.board = ? GROUP BY c.path ORDER BY c.path`
    )
    .all(b) as { path: string; messages: number }[];
}

// --- events (cursors) ---

export function listEvents(board: string, since: number, limit = 100) {
  return db
    .prepare("SELECT * FROM events WHERE board = ? AND id > ? ORDER BY id LIMIT ?")
    .all(board, since, limit);
}

// --- tasks ---

export function createTask(opts: {
  board?: string;
  channel: string;
  title: string;
  actor: string;
  profile?: string | null;
  labels?: Record<string, string>;
}): Task {
  const board = opts.board ?? DEFAULT_BOARD;
  const msg = postMessage({
    board,
    channel: opts.channel,
    body: opts.title,
    actor: opts.actor,
    profile: opts.profile,
    labels: { ...opts.labels, "state": "ready" },
  });
  const info = db
    .prepare(
      `INSERT INTO tasks (board, channel, title, state, thread_id, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', ?, ?, ?)`
    )
    .run(board, opts.channel, opts.title, msg.thread_id, now(), now());
  const id = Number(info.lastInsertRowid);
  emitEvent(board, "task", id, opts.channel);
  return getTask(id)!;
}

export function getTask(id: number): Task | null {
  return (db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined) ?? null;
}

export function listTasks(opts: {
  board?: string;
  state?: "ready" | "claimed" | "done" | "all";
  channel?: string;
  limit?: number;
}): Task[] {
  const board = opts.board ?? DEFAULT_BOARD;
  let sql = "SELECT * FROM tasks WHERE board = ?";
  const args: unknown[] = [board];
  if (opts.state && opts.state !== "all") {
    sql += " AND state = ?";
    args.push(opts.state);
  }
  if (opts.channel) {
    sql += " AND channel = ?";
    args.push(opts.channel);
  }
  sql += " ORDER BY id LIMIT ?";
  args.push(opts.limit ?? 100);
  return db.prepare(sql).all(...args) as Task[];
}

export function transitionTask(
  id: number,
  action: "claim" | "release" | "complete",
  actor: string
): Task | null {
  const task = getTask(id);
  if (!task) return null;
  const next =
    action === "claim" ? "claimed" : action === "release" ? "ready" : "done";
  const claimer = action === "claim" ? actor : null;
  if (action === "complete") {
    db.prepare("UPDATE tasks SET state = 'done', updated_at = ? WHERE id = ?").run(now(), id);
  } else {
    db.prepare("UPDATE tasks SET state = ?, claimer = ?, updated_at = ? WHERE id = ?").run(
      next,
      claimer,
      now(),
      id
    );
  }
  db.prepare("INSERT OR REPLACE INTO labels (message_id, key, value) VALUES (?, 'state', ?)").run(
    task.thread_id,
    next
  );
  emitEvent(task.board, "task", id, task.channel);
  return getTask(id);
}

// A ready task for an agent to claim: oldest ready, optionally in a channel.
export function nextReady(board: string, channel?: string): Task | null {
  let sql = "SELECT * FROM tasks WHERE board = ? AND state = 'ready'";
  const args: unknown[] = [board];
  if (channel) {
    sql += " AND channel = ?";
    args.push(channel);
  }
  sql += " ORDER BY id LIMIT 1";
  return (db.prepare(sql).get(...args) as Task | undefined) ?? null;
}
