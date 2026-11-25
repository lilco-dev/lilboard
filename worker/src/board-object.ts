import { DurableObject } from "cloudflare:workers";
import { createBoardStore, migrateTaskColumns, SCHEMA, taskOptions } from "@lilboard/core";
import type { Labels } from "@lilboard/core";
import { doSql } from "./sql-do";

// One Durable Object per board, all logic in @lilboard/core. The DO is
// single-threaded, which gives race-free task claims and lets us wake
// long-pollers in-memory the instant an event lands.
export class BoardObject extends DurableObject {
  private initialized = false;
  private waiters: (() => void)[] = [];

  private store = createBoardStore(doSql(this.ctx.storage), {
    onEmit: () => this.wake(),
  });

  private init() {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(SCHEMA);
    migrateTaskColumns(doSql(this.ctx.storage));
    this.initialized = true;
  }

  private wake() {
    const waiting = this.waiters;
    this.waiters = [];
    for (const resolve of waiting) resolve();
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
      if (segs[0] === "channels" && segs.length === 3 && segs[2] === "messages") {
        return this.messages(request, url, board, segs[1], actor, profile);
      }
      if (segs[0] === "poll" && segs.length === 1) return this.poll(url, board);
      if (segs[0] === "tasks" && segs.length === 1) {
        return this.tasks(request, url, board, actor, profile);
      }
      if (segs[0] === "tasks" && segs.length === 2) {
        return segs[1] === "claim"
          ? this.claim(request, board, actor, url.searchParams.get("channel"))
          : this.task(request, board, segs[1], actor);
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
      const after = Number(url.searchParams.get("after") ?? 0) || undefined;
      const limit = Number(url.searchParams.get("limit") ?? 100) || 100;
      const labelParam = url.searchParams.get("label");
      const label = labelParam
        ? (() => {
            const [key, value] = labelParam.split("=");
            return { key, value };
          })()
        : undefined;
      return Response.json({ board, channel, messages: this.store.listMessages({ board, channel, after, limit, label }) });
    }

    if (request.method === "POST") {
      return request.json().then((payload) => {
        const p = payload as { text?: string; thread?: number; labels?: Labels };
        if (!p?.text || typeof p.text !== "string") {
          return Response.json({ error: "body must be JSON with a text field" }, { status: 400 });
        }
        const message = this.store.postMessage({
          board,
          channel,
          body: p.text,
          actor,
          profile,
          thread: p.thread ?? null,
          labels: p.labels,
        });
        return Response.json({ message }, { status: 201 });
      });
    }

    return this.notFound();
  }

  // --- long-poll ---

  private async poll(url: URL, board: string): Promise<Response> {
    const since = Number(url.searchParams.get("since") ?? 0) || 0;
    const timeout = Math.min(Number(url.searchParams.get("timeout") ?? 25) || 25, 30);

    let events = this.store.listEvents(board, since);
    if (events.length === 0) {
      await this.waitForEvents(timeout * 1000);
      events = this.store.listEvents(board, since);
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
      const state = (url.searchParams.get("state") ?? "ready") as "ready" | "claimed" | "done" | "all";
      const channel = url.searchParams.get("channel") ?? undefined;
      const assignee = url.searchParams.get("assignee") ?? undefined;
      const claimer = url.searchParams.get("claimer") ?? undefined;
      return Response.json({ board, tasks: this.store.listTasks({ board, state, channel, assignee, claimer }) });
    }

    if (request.method === "POST") {
      return request.json().then((payload) => {
        const p = payload as { title?: string; channel?: string; labels?: Labels };
        if (typeof p?.title !== "string" || !p.title || typeof p?.channel !== "string" || !p.channel) {
          return Response.json({ error: "body must be JSON with title and channel" }, { status: 400 });
        }
        const options = taskOptions(p);
        if (!options) return Response.json({ error: "invalid description, assignee, due, or priority" }, { status: 400 });
        const task = this.store.createTask({ board, channel: p.channel, title: p.title, ...options, actor, profile, labels: p.labels });
        return Response.json({ task }, { status: 201 });
      });
    }

    return this.notFound();
  }

  private async claim(request: Request, board: string, actor: string, channel?: string | null): Promise<Response> {
    if (request.method !== "POST") return this.notFound();
    const body = await request.json().catch(() => null) as { id?: unknown } | null;
    if (body?.id !== undefined && (!Number.isSafeInteger(body.id) || Number(body.id) <= 0)) {
      return Response.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    // No await between choosing and claiming; the DO serializes requests.
    return Response.json({ task: this.store.claimReady(board, actor, channel ?? undefined, body?.id as number | undefined) });
  }

  private async task(request: Request, board: string, id: string, actor: string): Promise<Response> {
    if (request.method === "GET") {
      const task = this.store.getTask(Number(id));
      return task?.board === board ? Response.json({ task }) : this.notFound();
    }
    if (request.method === "POST") {
      const payload = await request.json().catch(() => null) as { action?: unknown } | null;
      const action = payload?.action;
      if (action !== "claim" && action !== "release" && action !== "complete") {
        return Response.json(
          { error: "body must be JSON with action: claim | release | complete" },
          { status: 400 }
        );
      }
      const task = this.store.transitionTask(board, Number(id), action, actor);
      if (!task) return this.notFound();
      if ("error" in task) return Response.json(task, { status: 409 });
      return Response.json({ task });
    }
    return this.notFound();
  }
}
