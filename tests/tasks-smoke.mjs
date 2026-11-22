// Run against an isolated lilboard instance (self-host or Worker), never a live board.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = process.env.DASHBOARD_URL ?? "http://127.0.0.1:3000";
const token = process.env.LILBOARD_TEST_TOKEN;
assert(token, "Set LILBOARD_TEST_TOKEN for an isolated instance");
const board = `tasks-smoke-${randomUUID()}`;
const base = `${origin}/api/boards/${board}`;

async function request(path, status, { method = "GET", body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}

const oldest = (await request("/tasks", 201, { method: "POST", body: { channel: "work", title: "Existing caller" } })).task;
assert.deepEqual([oldest.description, oldest.assignee, oldest.due, oldest.priority], [null, null, null, "normal"]);
const rich = (await request("/tasks", 201, { method: "POST", body: {
  channel: "work", title: "Detailed task", description: "Done when tests pass.",
  assignee: "muse", due: "2030-01-31", priority: "high",
} })).task;
assert.deepEqual([rich.description, rich.assignee, rich.due, rich.priority], ["Done when tests pass.", "muse", "2030-01-31", "high"]);
for (const invalid of [{ due: "2026-02-30" }, { priority: "urgent" }, { assignee: "not an agent" }, { description: "  " }]) {
  await request("/tasks", 400, { method: "POST", body: { channel: "work", title: "Invalid", ...invalid } });
}
const tasks = (await request("/tasks?state=all", 200)).tasks;
assert.equal(tasks.length, 2);
assert.equal(tasks.find((task) => task.id === rich.id).priority, "high");
assert.equal((await request(`/tasks/${rich.id}`, 200)).task.description, "Done when tests pass.");
assert.equal((await request("/tasks/claim", 400, { method: "POST", body: { id: "bad" } })).error, "id must be a positive integer");
assert.equal((await request("/tasks/claim", 200, { method: "POST", body: { id: rich.id } })).task.id, rich.id);
assert.equal((await request("/tasks/claim", 200, { method: "POST", body: { id: rich.id } })).task, null);
assert.equal((await request("/tasks/claim", 200, { method: "POST", body: {} })).task.id, oldest.id);
assert.equal((await request("/tasks/claim", 200, { method: "POST", body: {} })).task, null);

if (process.env.CHECK_UI) {
  const other = `${origin}/api/boards/tasks-other-${randomUUID()}/tasks/${rich.id}`;
  assert.equal((await fetch(other)).status, 404, "Task IDs must not cross boards");
  const html = await (await fetch(`${origin}/?board=${board}&task=${rich.id}`)).text();
  for (const value of ["Done when tests pass.", "muse", "2030-01-31", "high"]) assert(html.includes(value), `Missing ${value} in UI`);
}
console.log("Task smoke passed: optional fields, validation, list/detail, specific and oldest-ready claiming.");
