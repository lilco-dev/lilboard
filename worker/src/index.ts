import { BoardObject } from "./board-object";

export interface Env {
  BOARD: DurableObjectNamespace<BoardObject>;
  LILBOARD_TOKENS?: string;
  LILBOARD_BOARD?: string;
}

async function sha256bytes(s: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  );
}

// Reads are open; writes need a bearer token. The Worker has no filesystem,
// so LILBOARD_TOKENS is its only token source (the Node runtime also seeds
// from a lilvault-style LILBOARD_KEYS_DIR). Tokens must be 64 hex chars,
// same convention as lilvault. X-Board-Profile sets the display name only —
// a profile never changes permissions.

// Parsed once per token config; env vars are immutable per deployment.
let tokenCache:
  | { from: string; entries: { name: string; digest: Uint8Array }[] }
  | null = null;

async function parseTokens(env: Env) {
  const raw = env.LILBOARD_TOKENS ?? "";
  if (tokenCache?.from === raw) return tokenCache.entries;
  const entries: { name: string; digest: Uint8Array }[] = [];
  for (const pair of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [name, rest] = pair.split("=");
    const [token] = (rest ?? "").split(":");
    if (!name || !token) continue;
    if (!/^[0-9a-f]{64}$/.test(token.trim())) {
      throw new Error(
        `LILBOARD_TOKENS: token for ${name} must be 64 hex chars (openssl rand -hex 32)`
      );
    }
    entries.push({ name: name.trim(), digest: await sha256bytes(token.trim()) });
  }
  tokenCache = { from: raw, entries };
  return entries;
}

// Constant-time digest compare (32-byte sha256 digests), matching
// lilvault's subtle::ConstantTimeEq. Typed as a plain helper because
// workers-types and workerd disagree on where timingSafeEqual lives.
function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function actorFromRequest(req: Request, env: Env) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const candidate = await sha256bytes(auth.slice(7).trim());
  for (const entry of await parseTokens(env)) {
    if (ctEqual(candidate, entry.digest)) {
      return { actor: entry.name, profile: req.headers.get("x-board-profile") };
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
