import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

type Params = { params: Promise<{ name: string }> };

// Revoke an actor's token (shared lilco agent surface, see route.ts).
export async function DELETE(req: Request, { params }: Params) {
  const admin = requireAdmin(req);
  if (admin instanceof Response) return admin;
  const { name } = await params;
  // Self-revocation is refused so one bad request cannot lock every admin
  // out of the minting surface.
  if (name === admin.actor) {
    return Response.json({ error: "cannot revoke your own token" }, { status: 400 });
  }
  const info = db.prepare("DELETE FROM actors WHERE name = ?").run(name);
  if (!Number(info.changes)) {
    return Response.json({ error: "no such actor" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
