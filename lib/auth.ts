import { db, hashToken } from "./db";
import type { Actor } from "./core";

// Reads are open; writes need a bearer token seeded via LILBOARD_TOKENS.
// Agents pass their own token; X-Board-Profile sets the display name
// ("fx via ada"). A profile never changes permissions — same as Vercel's
// model, but with per-agent tokens instead of inheriting a human's access.
export function actorFromRequest(req: Request): Actor | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const hash = hashToken(auth.slice(7).trim());
  const row = db.prepare("SELECT name FROM actors WHERE token_hash = ?").get(hash) as
    | { name: string }
    | undefined;
  if (!row) return null;
  return { actor: row.name, profile: req.headers.get("x-board-profile") };
}

export function requireActor(req: Request): Actor | Response {
  const actor = actorFromRequest(req);
  if (!actor) {
    return Response.json({ error: "unauthorized: send Authorization: Bearer <token>" }, { status: 401 });
  }
  return actor;
}
