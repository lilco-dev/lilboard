import { DurableObject } from "cloudflare:workers";
import { createBoardStore, SCHEMA } from "@lilboard/core";
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
      return Response.json({ board, tasks: this.store.listTasks({ board, state, channel }) });
    }

    if (request.method === "POST") {
      return request.json().then((payload) => {
        const p = payload as { title?: string; channel?: string; labels?: Labels };
        if (!p?.title || !p?.channel) {
          return Response.json({ error: "body must be JSON with title and channel" }, { status: 400 });
        }
        const task = this.store.createTask({ board, channel: p.channel, title: p.title, actor, profile, labels: p.labels });
        return Response.json({ task }, { status: 201 });
      });
    }

    return this.notFound();
  }

  private claim(board: string, actor: string, channel?: string | null): Response {
    // Atomic: the DO is single-threaded, so two racing agents always get
    // different tasks.
    const task = this.store.nextReady(board, channel ?? undefined);
    if (!task) return Response.json({ task: null });
    return Response.json({ task: this.store.transitionTask(task.id, "claim", actor) });
  }

  private task(request: Request, id: string): Response | Promise<Response> {
    if (request.method === "GET") {
      const task = this.store.getTask(Number(id));
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
        const task = this.store.transitionTask(Number(id), action, request.headers.get("x-board-actor") ?? "anonymous");
        return task ? Response.json({ task }) : this.notFound();
      });
    }
    return this.notFound();
  }
}
