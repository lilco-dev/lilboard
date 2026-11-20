import { timingSafeEqual } from "node:crypto";
import { db, hashToken } from "./db";
import type { Actor } from "./core";

// Reads are open; writes need a bearer token seeded via LILBOARD_TOKENS,
// LILBOARD_KEYS_DIR or keys.mjs. Agents pass their own token;
// X-Board-Profile sets the display name ("fx via ada"). A profile never
// changes permissions — same as Vercel's model, but with per-agent tokens
// instead of inheriting a human's access. kind=admin may also mint and
// revoke tokens via /api/auth/agents.
export function actorFromRequest(req: Request): Actor | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const candidate = Buffer.from(hashToken(auth.slice(7).trim()), "hex");
  // Scan all rows with a constant-time digest compare — same as lilvault's
  // subtle::ConstantTimeEq — instead of an index lookup on the hash.
  const rows = db.prepare("SELECT name, kind, token_hash FROM actors").all() as {
    name: string;
    kind: string;
    token_hash: string;
  }[];
  for (const row of rows) {
    if (
      row.token_hash.length === 64 &&
      timingSafeEqual(candidate, Buffer.from(row.token_hash, "hex"))
    ) {
      return { actor: row.name, profile: req.headers.get("x-board-profile"), kind: row.kind };
    }
  }
  return null;
}

export function requireActor(req: Request): Actor | Response {
  const actor = actorFromRequest(req);
  if (!actor) {
    return Response.json({ error: "unauthorized: send Authorization: Bearer <token>" }, { status: 401 });
  }
  return actor;
}

export function requireAdmin(req: Request): Actor | Response {
  const actor = requireActor(req);
  if (actor instanceof Response) return actor;
  if (actor.kind !== "admin") {
    return Response.json({ error: "forbidden: token minting requires an admin actor" }, { status: 403 });
  }
  return actor;
}
