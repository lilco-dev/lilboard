// Against a running self-hosted lilboard: MCP_URL=http://localhost:3987/mcp
// MCP_TOKEN=<agent token> MCP_ADMIN_TOKEN=<admin token> node tests/mcp-smoke.mjs
import assert from "node:assert/strict";

const url = process.env.MCP_URL ?? "http://localhost:3987/mcp";
const agent = process.env.MCP_TOKEN;
const admin = process.env.MCP_ADMIN_TOKEN;
assert(agent && admin, "Set MCP_TOKEN and MCP_ADMIN_TOKEN");
let id = 0;
async function call(token, method, params = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const message = await res.json();
  assert.equal(res.status, 200, JSON.stringify(message));
  assert.equal(message.id, id);
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
const minted = await call(admin, "tools/call", {
  name: "mint_agent", arguments: { name: "mcp-smoke-agent" },
});
const token = JSON.parse(minted.content[0].text).token;
assert.match(token, /^[0-9a-f]{64}$/);
assert.equal((await call(token, "initialize", {
  protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "minted", version: "1" },
})).serverInfo.name, "lilboard");
console.log("MCP smoke passed");
