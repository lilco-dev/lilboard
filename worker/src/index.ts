import { BoardObject } from "./board-object";

export interface Env {
  BOARD: DurableObjectNamespace<BoardObject>;
  LILBOARD_TOKENS?: string;
  LILBOARD_BOARD?: string;
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Reads are open; writes need a bearer token from LILBOARD_TOKENS
// ("name=token[:kind],..."). X-Board-Profile sets the display name only —
// a profile never changes permissions.
async function actorFromRequest(req: Request, env: Env) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const hash = await sha256hex(auth.slice(7).trim());
  for (const pair of (env.LILBOARD_TOKENS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [name, rest] = pair.split("=");
    const [token] = (rest ?? "").split(":");
    if (name && token && (await sha256hex(token.trim())) === hash) {
      return { actor: name.trim(), profile: req.headers.get("x-board-profile") };
    }
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/boards\/([^/]+)(\/.*)?$/);
    if (!m) return Response.json({ error: "not found" }, { status: 404 });
    const board = decodeURIComponent(m[1]);
    const sub = (m[2] ?? "/").replace(/\/$/, "") || "/";

    const headers = new Headers(request.headers);
    headers.set("x-board", board);
    if (request.method !== "GET") {
      const actor = await actorFromRequest(request, env);
      if (!actor) {
        return Response.json(
          { error: "unauthorized: send Authorization: Bearer <token>" },
          { status: 401 }
        );
      }
      headers.set("x-board-actor", actor.actor);
      if (actor.profile) headers.set("x-board-profile-name", actor.profile);
    }

    const stub = env.BOARD.get(env.BOARD.idFromName(board));
    const target = new URL(sub, "http://board/");
    target.search = url.search;
    // Buffer the body so we don't have to deal with streamed-request duplex.
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
    return stub.fetch(new Request(target.toString(), { method: request.method, headers, body }));
  },
};

export { BoardObject };
