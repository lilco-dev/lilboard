import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const board = `ui-smoke-${randomUUID()}`;

async function page(params = {}) {
  const url = new URL("/", base);
  url.search = new URLSearchParams({ board, ...params });
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  return (await response.text()).replaceAll("<!-- -->", "");
}

const tasks = await page();
assert.ok(tasks.includes(board), "Shows the requested board");
assert.match(tasks, /<nav [^>]*aria-label="Space navigation"><div [^>]*><details [^>]*>[\s\S]*?role="group" aria-label="Switch space"[^>]*>[\s\S]*?<\/details>/);
assert.match(tasks, />Browse<\/span>/);
assert.ok(tasks.includes(`aria-current="page">${board}</span>`), "Marks the current space");
assert.match(tasks, /<h1>Tasks<\/h1>/);
assert.match(tasks, /aria-keyshortcuts="Meta\+K Control\+K"/);
assert.match(tasks, /<dialog [^>]*aria-labelledby=/);
assert.match(tasks, /aria-label="Filter tasks"[\s\S]*?>Status<\/span><select[\s\S]*?>Chat<\/span><select[\s\S]*?>Label<\/span><select/);
assert.doesNotMatch(tasks, /Apply filters/);
assert.match(tasks, /aria-label="Task density"/);
assert.match(tasks, /data-task-density="relaxed"/);
assert.ok(tasks.includes("No tasks"));

const filtered = await page({ view: "tasks", state: "claimed", task: "1" });
assert.match(filtered, /<option value="claimed" selected="">Claimed<\/option>/);
assert.match(filtered, />Clear filters<\/button>/);
assert.ok(filtered.includes("Task not found"), "Does not open a task from another board");
assert.match(filtered, /href="#workspace-inspector">Skip to details<\/a>/);
assert.match(filtered, /<aside id="workspace-inspector" /);
assert.ok(filtered.includes("view=tasks&amp;state=claimed\">Close"), "Closing a task preserves the filter");

const room = await page({ channel: "work/inbox" });
assert.match(room, /<h1>#work\/inbox<\/h1>/);
assert.ok(room.includes("No messages yet"));

const activity = await page({ view: "activity" });
assert.match(activity, /<h1>Activity<\/h1>/);
assert.ok(activity.includes("No activity yet"));

console.log("Workspace smoke passed");
