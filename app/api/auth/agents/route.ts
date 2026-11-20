import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { agentName, actorKinds, mintAgent, type ActorKind } from "@/lib/agent-keys";

// Token minting — the shared lilco agent surface (same JSON shape as
// lilvault's /v1/auth/agents). Only kind=admin actors may call it; the
// minted token is 64-hex, stored sha256-hashed, and shown exactly once.
// POSTing an existing name rotates its token.

export async function GET(req: Request) {
  const admin = requireAdmin(req);
  if (admin instanceof Response) return admin;
  const agents = db.prepare("SELECT name, kind FROM actors ORDER BY name").all();
  return Response.json({ agents });
}

export async function POST(req: Request) {
  const admin = requireAdmin(req);
  if (admin instanceof Response) return admin;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const kind = typeof body?.kind === "string" ? body.kind.trim() : "agent";
  if (!agentName.test(name)) {
    return Response.json(
      { error: "name must be 1-64 chars of letters, digits, - or _" },
      { status: 400 }
    );
  }
  if (!actorKinds.includes(kind as ActorKind)) {
    return Response.json({ error: "kind must be agent, person or admin" }, { status: 400 });
  }
  return Response.json(mintAgent(name, kind as ActorKind), { status: 201 });
}
