import { requireActor } from "@/lib/auth";
import { listErrorResponse } from "@/lib/core";
import { getItem, itemId, parseInput, updateItem, updateItemInput } from "@/lib/lists";

type Params = { params: Promise<{ board: string; channel: string; id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { board, channel, id } = await params;
  try {
    const item = getItem(board, channel, parseInput(itemId, Number(id)));
    return item ? Response.json({ item }) : Response.json({ error: "Item not found in this list." }, { status: 404 });
  } catch (error) {
    return listErrorResponse(error);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const actor = requireActor(req);
  if (actor instanceof Response) return actor;
  const { board, channel, id } = await params;
  try {
    const input = parseInput(updateItemInput, await req.json().catch(() => null));
    return Response.json({ item: updateItem(board, channel, parseInput(itemId, Number(id)), actor.actor, input) });
  } catch (error) {
    return listErrorResponse(error);
  }
}
