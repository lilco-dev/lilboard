"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@lilco/ui";

export function LiveBoard({ board, cursor }: { board: string; cursor: number }) {
  const router = useRouter();
  const lastEvent = useRef(String(cursor));
  const [status, setStatus] = useState<"Connecting" | "Live" | "Reconnecting">("Connecting");

  useEffect(() => {
    const source = new EventSource(`/api/boards/${encodeURIComponent(board)}/events?since=${lastEvent.current}`);
    let pending: ReturnType<typeof setTimeout> | undefined;

    source.onopen = () => setStatus("Live");
    source.onerror = () => setStatus("Reconnecting");
    source.addEventListener("board", (event: MessageEvent) => {
      lastEvent.current = event.lastEventId;
      if (pending !== undefined) return;
      pending = setTimeout(() => {
        pending = undefined;
        router.refresh();
      }, 75);
    });

    return () => {
      source.close();
      clearTimeout(pending);
    };
  }, [board, router]);

  return <span role="status"><Badge tone={status === "Live" ? "positive" : "neutral"}>{status}</Badge></span>;
}
