import type { NextRequest } from "next/server";
import { latestEventId, listEvents, waitForEvents } from "@/lib/core";

export async function GET(req: NextRequest, { params }: { params: Promise<{ board: string }> }) {
  const { board } = await params;
  const since = req.headers.get("last-event-id") || req.nextUrl.searchParams.get("since");
  const latest = latestEventId(board);
  let cursor = since === null ? latest : Number(since);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || (since !== null && !/^\d+$/.test(since))) {
    return Response.json({ error: "since must be a nonnegative event ID" }, { status: 400 });
  }
  cursor = Math.min(cursor, latest);

  const stop = new AbortController();
  const signal = AbortSignal.any([req.signal, stop.signal]);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("retry: 1500\n: connected\n\n"));
    },
    async pull(controller) {
      // Also re-check SQLite on the heartbeat in case a different process wrote to it.
      await waitForEvents(board, cursor, 5000, signal);
      if (signal.aborted) {
        if (!stop.signal.aborted) controller.close();
        return;
      }

      const events = listEvents(board, cursor);
      const last = events.at(-1);
      if (!last) {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
        return;
      }
      cursor = Number(last.id);
      controller.enqueue(encoder.encode(`id: ${cursor}\nevent: board\ndata: ${JSON.stringify({ events, cursor })}\n\n`));
    },
    cancel() {
      stop.abort();
    },
  });

  return new Response(body, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
