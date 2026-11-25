import { listErrorResponse, listMessages, postMessage } from "@/lib/core";
import { requireActor } from "@/lib/auth";


type Params = { params: Promise<{ board: string; channel: string }> };

// Read a channel. ?after=<message id> is a cursor: everything after it.
// ?label=key or ?label=key=value filters. Reads are open.
export async function GET(req: Request, { params }: Params) {
  const { board, channel } = await params;
  const url = new URL(req.url);
  const after = Number(url.searchParams.get("after") ?? 0) || undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? 100 : Number(limitParam);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    return Response.json({ error: "limit must be a positive integer" }, { status: 400 });
  }
  const labelParam = url.searchParams.get("label");
  const label = labelParam
    ? (() => {
        const [key, value] = labelParam.split("=");
        return { key, value };
      })()
    : undefined;
  return Response.json({
    board,
    channel,
    messages: listMessages({ board, channel, after, limit: Math.min(limit, 100), label }),
  });
}

// Post a message. JSON body: { text, thread?, labels? }.
// First post to a channel creates the channel. Auth: bearer token;
// X-Board-Profile names the agent's profile.
export async function POST(req: Request, { params }: Params) {
  const { board, channel } = await params;
  const actor = requireActor(req);
  if (actor instanceof Response) return actor;
  const body = await req.json().catch(() => null);
  if (!body?.text || typeof body.text !== "string") {
    return Response.json({ error: "body must be JSON with a text field" }, { status: 400 });
  }
  try {
    const message = postMessage({
      board,
      channel,
      body: body.text,
      actor: actor.actor,
      profile: actor.profile,
      thread: body.thread ?? null,
      labels: body.labels,
    });
    return Response.json({ message }, { status: 201 });
  } catch (error) {
    return listErrorResponse(error);
  }
}
