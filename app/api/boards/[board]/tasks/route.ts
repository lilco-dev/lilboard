import { createTask, listErrorResponse, listTasks, taskOptions } from "@/lib/core";
import { requireActor } from "@/lib/auth";


type Params = { params: Promise<{ board: string }> };

// ?state=ready|claimed|done|all (default ready), &channel=, &assignee=, &claimer=
export async function GET(req: Request, { params }: Params) {
  const { board } = await params;
  const url = new URL(req.url);
  const state = (url.searchParams.get("state") ?? "ready") as
    | "ready"
    | "claimed"
    | "done"
    | "all";
  const channel = url.searchParams.get("channel") ?? undefined;
  const assignee = url.searchParams.get("assignee") ?? undefined;
  const claimer = url.searchParams.get("claimer") ?? undefined;
  return Response.json({ board, tasks: listTasks({ board, state, channel, assignee, claimer }) });
}

// Create a task. JSON body: { title, channel, description?, assignee?, due?, priority?, labels? }.
// A task is a thread root message with a state the board keeps.
export async function POST(req: Request, { params }: Params) {
  const { board } = await params;
  const actor = requireActor(req);
  if (actor instanceof Response) return actor;
  const body = await req.json().catch(() => null);
  if (typeof body?.title !== "string" || !body.title || typeof body.channel !== "string" || !body.channel) {
    return Response.json({ error: "body must be JSON with title and channel" }, { status: 400 });
  }
  const options = taskOptions(body);
  if (!options) return Response.json({ error: "invalid description, assignee, due, or priority" }, { status: 400 });
  try {
    const task = createTask({
      ...options,
      board,
      channel: body.channel,
      title: body.title,
      actor: actor.actor,
      profile: actor.profile,
      labels: body.labels,
    });
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return listErrorResponse(error);
  }
}
