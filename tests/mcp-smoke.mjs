// Against a running self-hosted lilboard: MCP_URL=http://localhost:3987/mcp
// MCP_TOKEN=<agent token> MCP_ADMIN_TOKEN=<admin token> node tests/mcp-smoke.mjs
import assert from "node:assert/strict";

const url = process.env.MCP_URL ?? "http://localhost:3987/mcp";
const agent = process.env.MCP_TOKEN;
const admin = process.env.MCP_ADMIN_TOKEN;
assert(agent && admin, "Set MCP_TOKEN and MCP_ADMIN_TOKEN");
let id = 0;
async function call(token, method, params = {}) {
  const requestId = ++id;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
  });
  const body = await res.text();
  assert.equal(res.status, 200, body);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const messages = body.split(/\r?\n\r?\n/).flatMap((frame) =>
    frame.split(/\r?\n/).filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6))));
  const message = messages.find((item) => item.id === requestId);
  assert(message, body);
  assert(!message.error, JSON.stringify(message.error));
  return message.result;
}
const unauth = await fetch(url, { method: "POST" });
assert.equal(unauth.status, 401);
const init = await call(agent, "initialize", {
  protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "1" },
});
assert.equal(init.serverInfo.name, "lilboard");
const tools = await call(agent, "tools/list");
assert(tools.tools.some((tool) => tool.name === "post_message"));
assert(tools.tools.some((tool) => tool.name === "poll_events"));
assert(!tools.tools.some((tool) => tool.name === "mint_agent"));
const adminTools = await call(admin, "tools/list");
assert(adminTools.tools.some((tool) => tool.name === "mint_agent"));
const result = await call(agent, "tools/call", {
  name: "post_message", arguments: { board: "mcp-smoke", channel: "tests", text: "hello" },
});
const posted = JSON.parse(result.content[0].text).message;
assert.equal(posted.body, "hello");
const read = await call(agent, "tools/call", {
  name: "read_messages", arguments: { board: "mcp-smoke", channel: "tests" },
});
assert(JSON.parse(read.content[0].text).messages.some((message) => message.id === posted.id));
const initialPoll = await call(agent, "tools/call", {
  name: "poll_events", arguments: { board: "mcp-smoke", since: 0 },
});
const cursor = JSON.parse(initialPoll.content[0].text).cursor;
assert(cursor > 0);
const pending = call(agent, "tools/call", {
  name: "poll_events", arguments: { board: "mcp-smoke", since: cursor, timeout: 3 },
});
await new Promise((resolve) => setTimeout(resolve, 150));
await call(agent, "tools/call", {
  name: "post_message", arguments: { board: "mcp-smoke", channel: "tests", text: "wake poll" },
});
const { events, cursor: nextCursor } = JSON.parse((await pending).content[0].text);
assert(events.length && nextCursor > cursor);
const started = Date.now();
const empty = await call(agent, "tools/call", {
  name: "poll_events", arguments: { board: "empty-mcp-smoke", since: 0, timeout: 1 },
});
assert.deepEqual(JSON.parse(empty.content[0].text), { events: [], cursor: 0 });
assert(Date.now() - started >= 900);
const minted = await call(admin, "tools/call", {
  name: "mint_agent", arguments: { name: "mcp-smoke-agent" },
});
const token = JSON.parse(minted.content[0].text).token;
assert.match(token, /^[0-9a-f]{64}$/);
assert.equal((await call(token, "initialize", {
  protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "minted", version: "1" },
})).serverInfo.name, "lilboard");
console.log("MCP smoke passed");
