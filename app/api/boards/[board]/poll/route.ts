import { listEvents, hasEvents, waitForEvents } from "@/lib/core";


// Long-poll for new events. ?since=<event id> is the cursor,
// ?timeout=seconds (max 30, default 25). Returns when an event lands
// or the timeout expires — whichever first.
export async function GET(req: Request, ctx: { params: Promise<{ board: string }> }) {
  const { board } = await ctx.params;
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? 0) || 0;
  const timeout = Math.min(Number(url.searchParams.get("timeout") ?? 25) || 25, 30);

  if (!hasEvents(board, since)) {
    await waitForEvents(board, since, timeout * 1000);
  }
  const events = listEvents(board, since);
  return Response.json({
    events,
    cursor: events.length ? (events[events.length - 1] as { id: number }).id : since,
  });
}
