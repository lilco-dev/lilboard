// Against a running self-hosted lilboard: MCP_URL=http://localhost:3987/mcp
// MCP_TOKEN=<agent token> MCP_ADMIN_TOKEN=<admin token> node tests/mcp-smoke.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

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
assert.match(init.instructions, /post_message.*board='general'.*channel='general'/);
assert.match(init.instructions, /read_list.*board='general'.*channel='agents'/);
const tools = await call(agent, "tools/list");
assert(tools.tools.some((tool) => tool.name === "post_message"));
assert(tools.tools.some((tool) => tool.name === "poll_events"));
for (const name of ["register_list_schema", "create_list", "suggest_feedback"]) {
  assert(tools.tools.some((tool) => tool.name === name), `${name} should be available to agents`);
}
assert(!tools.tools.some((tool) => tool.name === "mint_agent"));
const adminTools = await call(admin, "tools/list");
assert(adminTools.tools.some((tool) => tool.name === "mint_agent"));
const listBoard = `mcp-lists-${randomUUID()}`;
const definition = JSON.parse(await readFile(new URL("../examples/gifts/gift-idea.schema.json", import.meta.url), "utf8"));
const registered = await call(agent, "tools/call", {
  name: "register_list_schema", arguments: { board: listBoard, schema_id: "gift-idea@1", definition },
});
assert(!registered.isError, JSON.stringify(registered));
assert.equal(JSON.parse(registered.content[0].text).id, "gift-idea@1");
const created = await call(agent, "tools/call", {
  name: "create_list", arguments: { board: listBoard, channel: "ideas", title: "Gift ideas", schema_id: "gift-idea@1" },
});
assert(!created.isError, JSON.stringify(created));
assert.equal(JSON.parse(created.content[0].text).list.channel, "ideas");
const added = await call(agent, "tools/call", {
  name: "add_list_item", arguments: {
    board: listBoard, channel: "ideas", fields: { title: "A gift", recipient: "Alex", status: "Idea" },
  },
});
assert(!added.isError, JSON.stringify(added));
const directory = JSON.parse(await readFile(new URL("../examples/agents/agent-capabilities.schema.json", import.meta.url), "utf8"));
const directorySchema = await call(agent, "tools/call", {
  name: "register_list_schema", arguments: { board: listBoard, schema_id: "agent-capabilities@1", definition: directory },
});
assert(!directorySchema.isError, JSON.stringify(directorySchema));
const directoryList = await call(agent, "tools/call", {
  name: "create_list", arguments: { board: listBoard, channel: "agents", title: "Agent capabilities", schema_id: "agent-capabilities@1", columns: ["title", "capabilities"] },
});
assert(!directoryList.isError, JSON.stringify(directoryList));
const entry = await call(agent, "tools/call", {
  name: "add_list_item", arguments: { board: listBoard, channel: "agents", fields: { title: "Smoke agent", capabilities: "Runs tests" }, request_key: "smoke-agent" },
});
assert(!entry.isError, JSON.stringify(entry));
assert.equal(JSON.parse(entry.content[0].text).item.fields.capabilities, "Runs tests");
const feedback = await call(agent, "tools/call", {
  name: "suggest_feedback", arguments: { kind: "bug", title: "Smoke test", description: "A test report." },
});
assert(!feedback.isError, JSON.stringify(feedback));
const filed = JSON.parse(feedback.content[0].text).message;
assert.equal(filed.channel, "feedback");
assert.equal(filed.labels.feedback, "bug");
assert.match(filed.body, /Smoke test/);
const saved = await call(agent, "tools/call", {
  name: "read_messages", arguments: { board: filed.board, channel: "feedback", after: filed.id - 1, limit: 1 },
});
assert.equal(JSON.parse(saved.content[0].text).messages[0].id, filed.id);
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
