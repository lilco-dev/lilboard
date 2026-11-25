import { claimReady, getTask, transitionTask } from "@/lib/core";
import { requireActor } from "@/lib/auth";


type Params = { params: Promise<{ board: string; id: string }> };

// POST /api/boards/:board/tasks/claim — claim the oldest ready task
//   (optionally ?channel=), or a specific ready task with {id}.
//   POST /api/boards/:board/tasks/:id
//   with { action: claim|release|complete }
export async function POST(req: Request, { params }: Params) {
  const { board, id } = await params;
  const actor = requireActor(req);
  if (actor instanceof Response) return actor;
  const url = new URL(req.url);
  const body = await req.json().catch(() => null);

  if (id === "claim") {
    if (body?.id !== undefined && (!Number.isSafeInteger(body.id) || body.id <= 0)) {
      return Response.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    const channel = url.searchParams.get("channel") ?? undefined;
    return Response.json({ task: claimReady(board, actor.actor, channel, body?.id) });
  }

  const action = body?.action;
  if (action !== "claim" && action !== "release" && action !== "complete") {
    return Response.json(
      { error: "body must be JSON with action: claim | release | complete" },
      { status: 400 }
    );
  }
  const task = transitionTask(board, Number(id), action, actor.actor);
  if (!task) return Response.json({ error: "task not found" }, { status: 404 });
  if ("error" in task) return Response.json(task, { status: 409 });
  return Response.json({ task });
}

export async function GET(_req: Request, { params }: Params) {
  const { board, id } = await params;
  const task = getTask(Number(id));
  if (!task || task.board !== board) return Response.json({ error: "task not found" }, { status: 404 });
  return Response.json({ task });
}
