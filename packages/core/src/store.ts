import type { Sql, Row, Labels } from "./sql";
import { one, lastId } from "./sql";

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
  labels: Labels;
  created_at: number;
};

export type TaskState = "ready" | "claimed" | "done";

export type Task = {
  id: number;
  board: string;
  channel: string;
  title: string;
  state: TaskState;
  claimer: string | null;
  thread_id: number;
  created_at: number;
  updated_at: number;
};

export type BoardStore = ReturnType<typeof createBoardStore>;

export function createBoardStore(
  sql: Sql,
  opts: { defaultBoard?: string; onEmit?: () => void } = {}
) {
  const defaultBoard = opts.defaultBoard ?? "general";
  const now = () => Date.now();

  function emit(board: string, kind: string, refId: number, channel?: string) {
    sql.exec(
      "INSERT INTO events (board, kind, ref_id, channel, created_at) VALUES (?, ?, ?, ?, ?)",
      board,
      kind,
      refId,
      channel ?? null,
      now()
    );
    opts.onEmit?.();
  }

  function ensureChannel(board: string, path: string) {
    sql.exec(
      "INSERT OR IGNORE INTO channels (board, path, created_at) VALUES (?, ?, ?)",
      board,
      path,
      now()
    );
  }

  function labelsOf(messageId: number): Labels {
    const out: Labels = {};
    for (const l of sql.query(
      "SELECT key, value FROM labels WHERE message_id = ?",
      messageId
    ) as { key: string; value: string }[]) {
      out[l.key] = l.value;
    }
    return out;
  }

  function display(actor: string, profile: string | null): string {
    return profile && profile !== actor ? `${profile} via ${actor}` : actor;
  }

  function decorate(row: Row): Message {
    const actor = row.actor as string;
    const profile = (row.profile as string | null) ?? null;
    return {
      ...(row as unknown as Message),
      profile,
      display: display(actor, profile),
      labels: labelsOf(row.id as number),
    };
  }

  function getMessage(id: number): Message | null {
    const row = one(sql, "SELECT * FROM messages WHERE id = ?", id);
    return row ? decorate(row) : null;
  }

  function postMessage(m: {
    board?: string;
    channel: string;
    body: string;
    actor: string;
    profile?: string | null;
    thread?: number | null;
    labels?: Labels;
  }): Message {
    const board = m.board ?? defaultBoard;
    ensureChannel(board, m.channel);
    const parent = m.thread ?? null;
    sql.exec(
      `INSERT INTO messages (board, channel, thread_id, parent_id, actor, profile, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      board,
      m.channel,
      0,
      parent,
      m.actor,
      m.profile ?? null,
      m.body,
      now()
    );
    const id = lastId(sql);
    const threadId = parent ?? id;
    sql.exec("UPDATE messages SET thread_id = ? WHERE id = ?", threadId, id);
    for (const [k, v] of Object.entries(m.labels ?? {})) {
      sql.exec(
        "INSERT OR REPLACE INTO labels (message_id, key, value) VALUES (?, ?, ?)",
        id,
        k,
        v
      );
    }
    emit(board, "message", id, m.channel);
    return getMessage(id)!;
  }

  function listMessages(o: {
    board?: string;
    channel: string;
    after?: number;
    limit?: number;
    label?: { key: string; value?: string };
  }): Message[] {
    const board = o.board ?? defaultBoard;
    let qs = "SELECT m.* FROM messages m WHERE m.board = ? AND m.channel = ?";
    const args: unknown[] = [board, o.channel];
    if (o.after) {
      qs += " AND m.id > ?";
      args.push(o.after);
    }
    if (o.label) {
      qs += " AND EXISTS (SELECT 1 FROM labels l WHERE l.message_id = m.id AND l.key = ?";
      args.push(o.label.key);
      if (o.label.value !== undefined) {
        qs += " AND l.value = ?";
        args.push(o.label.value);
      }
      qs += ")";
    }
    qs += " ORDER BY m.id LIMIT ?";
    args.push(o.limit ?? 100);
    return sql.query(qs, ...args).map(decorate);
  }

  function listChannels(board?: string): { path: string; messages: number }[] {
    return sql.query(
      `SELECT c.path, COUNT(m.id) AS messages FROM channels c
       LEFT JOIN messages m ON m.board = c.board AND m.channel = c.path
       WHERE c.board = ? GROUP BY c.path ORDER BY c.path`,
      board ?? defaultBoard
    ) as { path: string; messages: number }[];
  }

  function listEvents(board: string, since: number, limit = 100) {
    return sql.query(
      "SELECT * FROM events WHERE board = ? AND id > ? ORDER BY id LIMIT ?",
      board,
      since,
      limit
    );
  }

  function hasEvents(board: string, since: number): boolean {
    return !!one(sql, "SELECT 1 FROM events WHERE board = ? AND id > ? LIMIT 1", board, since);
  }

  function createTask(t: {
    board?: string;
    channel: string;
    title: string;
    actor: string;
    profile?: string | null;
    labels?: Labels;
  }): Task {
    const board = t.board ?? defaultBoard;
    const msg = postMessage({
      board,
      channel: t.channel,
      body: t.title,
      actor: t.actor,
      profile: t.profile,
      labels: { ...t.labels, state: "ready" },
    });
    sql.exec(
      `INSERT INTO tasks (board, channel, title, state, thread_id, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', ?, ?, ?)`,
      board,
      t.channel,
      t.title,
      msg.thread_id,
      now(),
      now()
    );
    const id = lastId(sql);
    emit(board, "task", id, t.channel);
    return getTask(id)!;
  }

  function getTask(id: number): Task | null {
    return (one(sql, "SELECT * FROM tasks WHERE id = ?", id) as Task | undefined) ?? null;
  }

  function listTasks(o: {
    board?: string;
    state?: TaskState | "all";
    channel?: string;
    limit?: number;
  }): Task[] {
    const board = o.board ?? defaultBoard;
    let qs = "SELECT * FROM tasks WHERE board = ?";
    const args: unknown[] = [board];
    if (o.state && o.state !== "all") {
      qs += " AND state = ?";
      args.push(o.state);
    }
    if (o.channel) {
      qs += " AND channel = ?";
      args.push(o.channel);
    }
    qs += " ORDER BY id LIMIT ?";
    args.push(o.limit ?? 100);
    return sql.query(qs, ...args) as Task[];
  }

  function transitionTask(id: number, action: "claim" | "release" | "complete", actor: string): Task | null {
    const task = getTask(id);
    if (!task) return null;
    if (action === "complete") {
      sql.exec("UPDATE tasks SET state = 'done', updated_at = ? WHERE id = ?", now(), id);
    } else {
      const next = action === "claim" ? "claimed" : "ready";
      sql.exec("UPDATE tasks SET state = ?, claimer = ?, updated_at = ? WHERE id = ?", next, action === "claim" ? actor : null, now(), id);
    }
    sql.exec(
      "INSERT OR REPLACE INTO labels (message_id, key, value) VALUES (?, 'state', ?)",
      task.thread_id,
      action === "complete" ? "done" : action === "claim" ? "claimed" : "ready"
    );
    emit(task.board, "task", id, task.channel);
    return getTask(id);
  }

  // Oldest ready task, optionally within a channel. On the DO runtime this
  // is atomic (single-threaded object); on Node it is atomic within one
  // process, which is the whole deployment.
  function nextReady(board: string, channel?: string): Task | null {
    let qs = "SELECT * FROM tasks WHERE board = ? AND state = 'ready'";
    const args: unknown[] = [board];
    if (channel) {
      qs += " AND channel = ?";
      args.push(channel);
    }
    qs += " ORDER BY id LIMIT 1";
    return (one(sql, qs, ...args) as Task | undefined) ?? null;
  }

  return {
    defaultBoard,
    postMessage,
    getMessage,
    listMessages,
    listChannels,
    listEvents,
    hasEvents,
    createTask,
    getTask,
    listTasks,
    transitionTask,
    nextReady,
  };
}
