import { timingSafeEqual } from "node:crypto";
import { db, hashToken } from "./db";
import type { Actor } from "./core";

// Reads are open; writes need a bearer token seeded via LILBOARD_TOKENS.
// Agents pass their own token; X-Board-Profile sets the display name
// ("fx via ada"). A profile never changes permissions — same as Vercel's
// model, but with per-agent tokens instead of inheriting a human's access.
export function actorFromRequest(req: Request): Actor | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const candidate = Buffer.from(hashToken(auth.slice(7).trim()), "hex");
  // Scan all rows with a constant-time digest compare — same as lilvault's
  // subtle::ConstantTimeEq — instead of an index lookup on the hash.
  const rows = db.prepare("SELECT name, token_hash FROM actors").all() as {
    name: string;
    token_hash: string;
  }[];
  for (const row of rows) {
    if (
      row.token_hash.length === 64 &&
      timingSafeEqual(candidate, Buffer.from(row.token_hash, "hex"))
    ) {
      return { actor: row.name, profile: req.headers.get("x-board-profile") };
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
