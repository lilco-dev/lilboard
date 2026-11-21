import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const origin = process.env.DASHBOARD_URL ?? "http://127.0.0.1:3000";
const agent = process.env.LILBOARD_TEST_TOKEN;
assert.ok(agent, "Run against an isolated instance with an agent test token.");
const board = `lists-smoke-${randomUUID()}`;
const base = `${origin}/api/boards/${board}`;
const list = `${base}/channels/ideas/list`;
const messages = `${base}/channels/ideas/messages`;
const definition = JSON.parse(await readFile(new URL("../examples/gifts/gift-idea.schema.json", import.meta.url), "utf8"));

async function request(url, status, { method = "GET", token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, status, `${method} ${new URL(url).pathname}`);
  return response.json();
}

const schema = `${base}/schemas/gift-idea@1`;
await request(schema, 401, { method: "PUT", body: definition });
await request(schema, 201, { method: "PUT", token: agent, body: definition });
await request(schema, 409, { method: "PUT", token: agent, body: definition });
await request(list, 401, { method: "PUT", body: { title: "Gift ideas", schema_id: "gift-idea@1" } });
await request(list, 201, {
  method: "PUT", token: agent,
  body: { title: "Gift ideas", schema_id: "gift-idea@1", columns: ["title", "recipient", "price", "status"], make_default: true },
});

const fields = { title: "Ceramics workshop", recipient: "Alex", price: 85, status: "Idea", notes: "Likes pottery." };
const body = { fields, request_key: "test-1" };
await request(list, 400, { method: "POST", token: agent, body: { fields: { ...fields, status: "bad" } } });
const first = await request(list, 201, { method: "POST", token: agent, body });
const retry = await request(list, 201, { method: "POST", token: agent, body });
assert.equal(first.item.id, retry.item.id);
const itemEndpoint = `${list}/items/${first.item.id}`;
await request(itemEndpoint, 400, { method: "PATCH", token: agent, body: { fields: { recipient: null } } });
const changed = await request(itemEndpoint, 200, { method: "PATCH", token: agent, body: { fields: { price: 79 } } });
assert.deepEqual(changed.item.fields, { ...fields, price: 79 });

await request(messages, 400, { method: "POST", token: agent, body: { text: "Not an item" } });
await request(messages, 400, { method: "POST", token: agent, body: { text: "No such item", thread: first.item.id + 90000 } });
await request(messages, 201, { method: "POST", token: agent, body: { text: "Saturday works.", thread: first.item.id } });
await request(`${base}/tasks`, 400, { method: "POST", token: agent, body: { title: "Buy", channel: "ideas" } });

const page = await request(`${list}?field=status&value=Idea`, 200);
assert.equal(page.list.schema_id, "gift-idea@1");
assert.equal(page.items.length, 1);
assert.equal((await request(`${list}?field=status&value=Bought`, 200)).items.length, 0);

const activity = await request(`${base}/poll?since=0`, 200);
assert.equal(activity.events.filter((event) => event.kind === "list_item" && event.ref_id === first.item.id).length, 2);
assert.equal(activity.events.filter((event) => event.kind === "message").length, 1);
const html = await (await fetch(`${origin}/?board=${board}&item=${first.item.id}`, { signal: AbortSignal.timeout(10000) })).text();
assert.match(html, /<h1>Gift ideas<\/h1>/);
assert.match(html, /Saturday works\./);
assert.match(html, /Likes pottery\./);
console.log("Lists smoke passed: setup, validation, patch, idempotency, discussion, filtering, and Activity.");
