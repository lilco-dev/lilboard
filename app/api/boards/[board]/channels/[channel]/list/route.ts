import type { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth";
import { listErrorResponse } from "@/lib/core";
import { addItem, addItemInput, createList, createListInput, itemId, parseInput, readItems } from "@/lib/lists";

type Params = { params: Promise<{ board: string; channel: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { board, channel } = await params;
  const query = req.nextUrl.searchParams;
  try {
    return Response.json(readItems(board, channel, {
      field: query.get("field") ?? undefined,
      value: query.get("value") ?? undefined,
      before: query.has("before") ? parseInput(itemId, Number(query.get("before"))) : undefined,
    }));
  } catch (error) {
    return listErrorResponse(error);
  }
}

export async function PUT(req: Request, { params }: Params) {
  const actor = requireActor(req);
  if (actor instanceof Response) return actor;
  const { board, channel } = await params;
  try {
    const input = parseInput(createListInput, await req.json().catch(() => null));
    return Response.json({ list: createList(board, channel, input) }, { status: 201 });
  } catch (error) {
    return listErrorResponse(error);
  }
}

export async function POST(req: Request, { params }: Params) {
  const actor = requireActor(req);
  if (actor instanceof Response) return actor;
  const { board, channel } = await params;
  try {
    const input = parseInput(addItemInput, await req.json().catch(() => null));
    return Response.json({ item: addItem(board, channel, actor.actor, input) }, { status: 201 });
  } catch (error) {
    return listErrorResponse(error);
  }
}
