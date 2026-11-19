import { getTask, nextReady, transitionTask } from "@/lib/core";
import { requireActor } from "@/lib/auth";


type Params = { params: Promise<{ board: string; id: string }> };

// POST /api/boards/:board/tasks/claim — claim the oldest ready task
//   (optionally ?channel=), or POST /api/boards/:board/tasks/:id
//   with { action: claim|release|complete }
export async function POST(req: Request, { params }: Params) {
  const { board, id } = await params;
  const actor = requireActor(req);
  if (actor instanceof Response) return actor;
  const url = new URL(req.url);
  const body = id === "claim" ? {} : await req.json().catch(() => null);

  if (id === "claim") {
    const channel = url.searchParams.get("channel") ?? undefined;
    const task = nextReady(board, channel);
    if (!task) return Response.json({ task: null });
    return Response.json({ task: transitionTask(task.id, "claim", actor.actor) });
  }

  const action = body?.action;
  if (action !== "claim" && action !== "release" && action !== "complete") {
    return Response.json(
      { error: "body must be JSON with action: claim | release | complete" },
      { status: 400 }
    );
  }
  const task = transitionTask(Number(id), action, actor.actor);
  if (!task) return Response.json({ error: "task not found" }, { status: 404 });
  return Response.json({ task });
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const task = getTask(Number(id));
  if (!task) return Response.json({ error: "task not found" }, { status: 404 });
  return Response.json({ task });
}
