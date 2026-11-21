import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = process.env.DASHBOARD_URL ?? "http://127.0.0.1:3000";
const token = process.env.LILBOARD_TEST_TOKEN;
assert.ok(token, "Run against an isolated instance with LILBOARD_TEST_TOKEN set");

const board = `live-smoke-${randomUUID()}`;
const endpoint = `${origin}/api/boards/${board}`;

async function post(text, url = endpoint) {
  const response = await fetch(`${url}/channels/general/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `Post failed with HTTP ${response.status}`);
}

async function connect(lastId) {
  const response = await fetch(`${endpoint}/events?since=0`, {
    headers: lastId === undefined ? {} : { "Last-Event-ID": String(lastId) },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next() {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) {
          const { value, done } = await reader.read();
          assert.ok(!done, "Event stream closed without a board event");
          buffer += decoder.decode(value, { stream: true });
          continue;
        }

        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!data) continue;
        assert.match(frame, /\nevent: board\n/);
        const update = JSON.parse(data.slice(6));
        assert.ok(frame.startsWith(`id: ${update.cursor}\n`));
        return update;
      }
    },
    close: () => reader.cancel(),
  };
}

const live = await connect();
let first;
try {
  await post("Not on this board", `${endpoint}-other`);
  await post("First update");
  first = await live.next();
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].board, board);
  assert.equal(first.events[0].kind, "message");
} finally {
  await live.close();
}

await post("Second update");
const replay = await connect(first.cursor);
try {
  const update = await replay.next();
  assert.equal(update.events.length, 1);
  assert.ok(update.cursor > first.cursor);
} finally {
  await replay.close();
}

console.log("Live event smoke passed: board scoping, push, and Last-Event-ID resume");
