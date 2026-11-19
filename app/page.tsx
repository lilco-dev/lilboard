import { listChannels, listMessages, listTasks } from "@/lib/core";
import { DEFAULT_BOARD } from "@/lib/db";


// Server-rendered overview: channels, latest messages, open tasks.
// ?channel=<path> narrows the message list; ?board=<name> overrides default.
export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; board?: string }>;
}) {
  return (
    <Suspense fallback={<main style={{ padding: "2rem", fontFamily: "system-ui" }}>loading…</main>}>
      <Board searchParams={searchParams} />
    </Suspense>
  );
}

import { Suspense } from "react";

async function Board({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; board?: string }>;
}) {
  const sp = await searchParams;
  const board = sp.board ?? DEFAULT_BOARD;
  const channel = sp.channel ?? listChannels(board)[0]?.path ?? "general";
  const channels = listChannels(board);
  const messages = listMessages({ board, channel, limit: 50 });
  const ready = listTasks({ board, state: "ready" });
  const claimed = listTasks({ board, state: "claimed" });

  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <h1>lilboard</h1>
      <p style={{ color: "#666" }}>
        board <b>{board}</b> / channel <b>{channel}</b> —{" "}
        {channels.map((c) => (
          <a key={c.path} href={`?channel=${c.path}`} style={{ marginRight: "0.75rem" }}>
            #{c.path} ({c.messages})
          </a>
        ))}
      </p>

      <section>
        <h2>messages</h2>
        {messages.length === 0 && <p style={{ color: "#666" }}>no messages yet</p>}
        {messages.map((m) => (
          <div key={m.id} style={{ borderBottom: "1px solid #eee", padding: "0.4rem 0" }}>
            <span style={{ color: "#999", fontSize: "0.8rem" }}>
              #{m.id} {new Date(m.created_at).toISOString()} {m.display}
            </span>
            <div>
              {m.body}
              {Object.entries(m.labels).map(([k, v]) => (
                <span
                  key={k}
                  style={{
                    marginLeft: "0.5rem",
                    fontSize: "0.75rem",
                    background: "#f0f0f0",
                    padding: "0 0.4rem",
                    borderRadius: 4,
                  }}
                >
                  {k}={v}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2>tasks — ready ({ready.length})</h2>
        {ready.map((t) => (
          <div key={t.id}>
            #{t.id} <b>{t.channel}</b> {t.title}
          </div>
        ))}
        <h2>tasks — claimed ({claimed.length})</h2>
        {claimed.map((t) => (
          <div key={t.id}>
            #{t.id} <b>{t.channel}</b> {t.title} — {t.claimer}
          </div>
        ))}
      </section>
    </main>
  );
}
