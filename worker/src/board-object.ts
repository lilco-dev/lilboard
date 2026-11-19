import { DurableObject } from "cloudflare:workers";

// One Durable Object per board. The DO is single-threaded, which gives us
// two things the Next.js + node:sqlite version can't: race-free task claims
// and an in-memory notifier that wakes long-polleres the instant an event
// lands. Storage is the DO's embedded SQLite, same schema as the Node version.

const SCHEMA = `
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

type Row = Record<string, unknown>;
type Labels = Record<string, string>;

function display(actor: string, profile: string | null): string {
  return profile && profile !== actor ? `${profile} via ${actor}` : actor;
}

export class BoardObject extends DurableObject {
  private waiters: (() => void)[] = [];
  private initialized = false;

  private init() {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(SCHEMA);
    this.initialized = true;
  }

  private q(sql: string, ...args: unknown[]): Row[] {
    return this.ctx.storage.sql.exec(sql, ...args).toArray() as Row[];
  }

  private one(sql: string, ...args: unknown[]): Row | undefined {
    return this.q(sql, ...args)[0];
  }

  private exec(sql: string, ...args: unknown[]) {
    this.ctx.storage.sql.exec(sql, ...args);
  }

  private lastId(): number {
    return Number((this.one("SELECT last_insert_rowid() AS id") as { id: number }).id);
  }

  private emit(board: string, kind: string, refId: number, channel: string) {
    this.exec(
      "INSERT INTO events (board, kind, ref_id, channel, created_at) VALUES (?, ?, ?, ?, ?)",
      board,
      kind,
      refId,
      channel,
      Date.now()
    );
    const waiting = this.waiters;
    this.waiters = [];
    for (const resolve of waiting) resolve();
  }

  private labelsOf(messageId: number): Labels {
    const out: Labels = {};
    for (const l of this.q("SELECT key, value FROM labels WHERE message_id = ?", messageId) as {
      key: string;
      value: string;
    }[]) {
      out[l.key] = l.value;
    }
    return out;
  }

  private decorate(row: Row) {
    const actor = row.actor as string;
    const profile = (row.profile as string | null) ?? null;
    return { ...row, profile, display: display(actor, profile), labels: this.labelsOf(row.id as number) };
  }

  private waitForEvents(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((r) => r !== wake);
        resolve();
      }, timeoutMs);
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push(wake);
    });
  }

  async fetch(request: Request): Promise<Response> {
    this.init();
    const url = new URL(request.url);
    const board = request.headers.get("x-board") ?? "general";
    const actor = request.headers.get("x-board-actor") ?? "anonymous";
    const profile = request.headers.get("x-board-profile-name");
    const path = url.pathname.replace(/\/$/, "") || "/";
    const segs = path.split("/").filter(Boolean); // e.g. ["channels","dev","messages"]

    try {
      if (segs[0] === "channels" && segs[2] === "messages") {
        const channel = segs[1];
        return segs.length === 3
          ? this.messages(request, url, board, channel, actor, profile)
          : this.notFound();
      }
      if (segs[0] === "poll" && segs.length === 1) return this.poll(url, board);
      if (segs[0] === "tasks" && segs.length === 1) return this.tasks(request, url, board, actor, profile);
      if (segs[0] === "tasks" && segs.length === 2) {
        return segs[1] === "claim"
          ? this.claim(board, actor, url.searchParams.get("channel"))
          : this.task(request, segs[1]);
      }
      return this.notFound();
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 });
    }
  }

  private notFound() {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // --- channels / messages ---

  private messages(
    request: Request,
    url: URL,
    board: string,
    channel: string,
    actor: string,
    profile: string | null
  ): Response | Promise<Response> {
    if (request.method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      const limit = Number(url.searchParams.get("limit") ?? 100) || 100;
      const labelParam = url.searchParams.get("label");
      let sql = "SELECT m.* FROM messages m WHERE m.board = ? AND m.channel = ? AND m.id > ?";
      const args: unknown[] = [board, channel, after];
      if (labelParam) {
        const [key, value] = labelParam.split("=");
        sql += " AND EXISTS (SELECT 1 FROM labels l WHERE l.message_id = m.id AND l.key = ?";
        args.push(key);
        if (value !== undefined) {
          sql += " AND l.value = ?";
          args.push(value);
        }
        sql += ")";
      }
      sql += " ORDER BY m.id LIMIT ?";
      args.push(limit);
      const messages = this.q(sql, ...args).map((r) => this.decorate(r));
      return Response.json({ board, channel, messages });
    }

    if (request.method === "POST") {
      return request.json().then((payload) => {
        const p = payload as { text?: string; thread?: number; labels?: Labels };
        if (!p?.text || typeof p.text !== "string") {
          return Response.json({ error: "body must be JSON with a text field" }, { status: 400 });
        }
        this.exec(
          "INSERT OR IGNORE INTO channels (board, path, created_at) VALUES (?, ?, ?)",
          board,
          channel,
          Date.now()
        );
        const parent = p.thread ?? null;
        this.exec(
          `INSERT INTO messages (board, channel, thread_id, parent_id, actor, profile, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          board,
          channel,
          0,
          parent,
          actor,
          profile,
          p.text,
          Date.now()
        );
        const id = this.lastId();
        const threadId = parent ?? id;
        this.exec("UPDATE messages SET thread_id = ? WHERE id = ?", threadId, id);
        for (const [k, v] of Object.entries(p.labels ?? {})) {
          this.exec(
            "INSERT OR REPLACE INTO labels (message_id, key, value) VALUES (?, ?, ?)",
            id,
            k,
            v
          );
        }
        this.emit(board, "message", id, channel);
        const message = this.decorate(this.one("SELECT * FROM messages WHERE id = ?", id)!);
        return Response.json({ message }, { status: 201 });
      });
    }

    return this.notFound();
  }

  // --- long-poll ---

  private async poll(url: URL, board: string): Promise<Response> {
    const since = Number(url.searchParams.get("since") ?? 0) || 0;
    const timeout = Math.min(Number(url.searchParams.get("timeout") ?? 25) || 25, 30);

    let events = this.q("SELECT * FROM events WHERE board = ? AND id > ? ORDER BY id LIMIT 100", board, since);
    if (events.length === 0) {
      await this.waitForEvents(timeout * 1000);
      events = this.q("SELECT * FROM events WHERE board = ? AND id > ? ORDER BY id LIMIT 100", board, since);
    }
    const cursor = events.length ? (events[events.length - 1].id as number) : since;
    return Response.json({ events, cursor });
  }

  // --- tasks ---

  private tasks(
    request: Request,
    url: URL,
    board: string,
    actor: string,
    profile: string | null
  ): Response | Promise<Response> {
    if (request.method === "GET") {
      const state = url.searchParams.get("state") ?? "ready";
      const channel = url.searchParams.get("channel");
      let sql = "SELECT * FROM tasks WHERE board = ?";
      const args: unknown[] = [board];
      if (state !== "all") {
        sql += " AND state = ?";
        args.push(state);
      }
      if (channel) {
        sql += " AND channel = ?";
        args.push(channel);
      }
      sql += " ORDER BY id LIMIT 100";
      return Response.json({ board, tasks: this.q(sql, ...args) });
    }

    if (request.method === "POST") {
      return request.json().then((payload) => {
        const p = payload as { title?: string; channel?: string; labels?: Labels };
        if (!p?.title || !p?.channel) {
          return Response.json({ error: "body must be JSON with title and channel" }, { status: 400 });
        }
        const msg = this.postMessageInternal(board, p.channel, p.title, actor, profile, {
          ...p.labels,
          state: "ready",
        });
        this.exec(
          `INSERT INTO tasks (board, channel, title, state, thread_id, created_at, updated_at)
           VALUES (?, ?, ?, 'ready', ?, ?, ?)`,
          board,
          p.channel,
          p.title,
          msg.threadId,
          Date.now(),
          Date.now()
        );
        const id = this.lastId();
        this.emit(board, "task", id, p.channel);
        return Response.json({ task: this.one("SELECT * FROM tasks WHERE id = ?", id) }, { status: 201 });
      });
    }

    return this.notFound();
  }

  private postMessageInternal(
    board: string,
    channel: string,
    text: string,
    actor: string,
    profile: string | null,
    labels: Labels
  ): { id: number; threadId: number } {
    this.exec(
      "INSERT OR IGNORE INTO channels (board, path, created_at) VALUES (?, ?, ?)",
      board,
      channel,
      Date.now()
    );
    this.exec(
      `INSERT INTO messages (board, channel, thread_id, parent_id, actor, profile, body, created_at)
       VALUES (?, ?, 0, NULL, ?, ?, ?, ?)`,
      board,
      channel,
      actor,
      profile,
      text,
      Date.now()
    );
    const id = this.lastId();
    this.exec("UPDATE messages SET thread_id = ? WHERE id = ?", id, id);
    for (const [k, v] of Object.entries(labels)) {
      this.exec("INSERT OR REPLACE INTO labels (message_id, key, value) VALUES (?, ?, ?)", id, k, v);
    }
    this.emit(board, "message", id, channel);
    return { id, threadId: id };
  }

  private claim(board: string, actor: string, channel?: string | null): Response {
    // Single-threaded DO: claim is atomic. Two agents racing get
    // different tasks; never the same one twice.
    let sql = "SELECT * FROM tasks WHERE board = ? AND state = 'ready'";
    const args: unknown[] = [board];
    if (channel) {
      sql += " AND channel = ?";
      args.push(channel);
    }
    sql += " ORDER BY id LIMIT 1";
    const task = this.one(sql, ...args);
    if (!task) return Response.json({ task: null });
    return this.transition(task.id as number, "claim", actor);
  }

  private task(request: Request, id: string): Response | Promise<Response> {
    if (request.method === "GET") {
      const task = this.one("SELECT * FROM tasks WHERE id = ?", Number(id));
      return task ? Response.json({ task }) : this.notFound();
    }
    if (request.method === "POST") {
      return request.json().then((payload) => {
        const action = (payload as { action?: string }).action;
        if (action !== "claim" && action !== "release" && action !== "complete") {
          return Response.json(
            { error: "body must be JSON with action: claim | release | complete" },
            { status: 400 }
          );
        }
        const result = this.transition(Number(id), action, request.headers.get("x-board-actor") ?? "anonymous");
        return result ?? this.notFound();
      });
    }
    return this.notFound();
  }

  private transition(id: number, action: string, actor: string): Response {
    const task = this.one("SELECT * FROM tasks WHERE id = ?", id);
    if (!task) return this.notFound();
    const now = Date.now();
    if (action === "complete") {
      this.exec("UPDATE tasks SET state = 'done', updated_at = ? WHERE id = ?", now, id);
    } else {
      const next = action === "claim" ? "claimed" : "ready";
      const claimer = action === "claim" ? actor : null;
      this.exec("UPDATE tasks SET state = ?, claimer = ?, updated_at = ? WHERE id = ?", next, claimer, now, id);
    }
    this.exec("INSERT OR REPLACE INTO labels (message_id, key, value) VALUES (?, 'state', ?)", task.thread_id as number, action === "complete" ? "done" : action === "claim" ? "claimed" : "ready");
    this.emit(task.board as string, "task", id, task.channel as string);
    return Response.json({ task: this.one("SELECT * FROM tasks WHERE id = ?", id) });
  }
}
