// Run against an isolated lilboard instance (self-host or Worker), never a live board.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = process.env.DASHBOARD_URL ?? "http://127.0.0.1:3000";
const token = process.env.LILBOARD_TEST_TOKEN;
assert(token, "Set LILBOARD_TEST_TOKEN for an isolated instance");
const board = `tasks-smoke-${randomUUID()}`;
const base = `${origin}/api/boards/${board}`;

async function request(path, status, { method = "GET", body, as = token } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${as}`, ...(body && { "content-type": "application/json" }) },
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
assert.deepEqual((await request("/tasks?assignee=muse", 200)).tasks, [rich]);
assert.equal((await request("/tasks/claim", 400, { method: "POST", body: { id: "bad" } })).error, "id must be a positive integer");
const transition = (action, status, as) => request(`/tasks/${rich.id}`, status, { method: "POST", body: { action }, as });
await transition("complete", 409);
const claimed = (await request("/tasks/claim", 200, { method: "POST", body: { id: rich.id } })).task;
assert.equal(claimed.id, rich.id);
assert.deepEqual((await request(`/tasks?state=claimed&claimer=${encodeURIComponent(claimed.claimer)}`, 200)).tasks, [claimed]);
assert.equal((await request("/tasks/claim", 200, { method: "POST", body: { id: rich.id } })).task, null);
await transition("claim", 409);
const otherToken = process.env.LILBOARD_OTHER_TEST_TOKEN;
if (otherToken) {
  await transition("release", 409, otherToken);
  await transition("complete", 409, otherToken);
}
assert.deepEqual((await request(`/tasks/${rich.id}`, 200)).task, claimed);
assert.equal((await request("/tasks/claim", 200, { method: "POST", body: {} })).task.id, oldest.id);
assert.equal((await request("/tasks/claim", 200, { method: "POST", body: {} })).task, null);
const released = (await transition("release", 200)).task;
assert.deepEqual([released.state, released.claimer], ["ready", null]);
assert.equal((await transition("claim", 200)).task.claimer, claimed.claimer);
assert.equal((await transition("complete", 200)).task.state, "done");
await transition("claim", 409);

// Public message reads must reject unusable limits instead of reading unbounded.
for (const bad of ["-1", "0", "abc"]) {
  assert.equal((await request(`/channels/work/messages?limit=${bad}`, 400)).error, "limit must be a positive integer");
}
assert.equal((await request("/channels/work/messages?limit=1", 200)).messages.length, 1);
assert((await request("/channels/work/messages?limit=10000", 200)).messages.length > 0, "large limits are capped, not rejected");

if (process.env.CHECK_UI) {
  const other = `${origin}/api/boards/tasks-other-${randomUUID()}/tasks/${rich.id}`;
  assert.equal((await fetch(other)).status, 404, "Task IDs must not cross boards");
  const html = await (await fetch(`${origin}/?board=${board}&task=${rich.id}`)).text();
  for (const value of ["Done when tests pass.", "muse", "2030-01-31", "high"]) assert(html.includes(value), `Missing ${value} in UI`);
}
console.log("Task smoke passed: optional fields, filters, claims, transition guards, and message read limits.");
