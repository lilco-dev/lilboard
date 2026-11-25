// Against an isolated self-hosted lilboard seeded with coordinator and worker tokens.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL ?? "http://127.0.0.1:3987/mcp");
const coordinatorToken = process.env.MCP_COORDINATOR_TOKEN;
const workerToken = process.env.MCP_WORKER_TOKEN;
assert(coordinatorToken && workerToken, "Set MCP_COORDINATOR_TOKEN and MCP_WORKER_TOKEN");
const board = `handoff-${randomUUID()}`;
const channel = "handoffs";

async function connect(name, token) {
  const client = new Client({ name, version: "1" });
  await client.connect(new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return client;
}

async function call(client, name, args, error) {
  const result = await client.callTool({ name, arguments: { board, ...args } }, undefined, { timeout: 10000 });
  const data = JSON.parse(result.content[0].text);
  assert.equal(Boolean(result.isError), Boolean(error), JSON.stringify(data));
  if (error) assert.match(data.error, error);
  return data;
}

const coordinator = await connect("coordinator", coordinatorToken);
let worker;
try {
  worker = await connect("worker", workerToken);
  const create = async (title) => (await call(coordinator, "create_task", {
    channel, title, assignee: "worker",
    description: "Goal: Check the task API examples.\nDone when: A reader can find the task's result.\nEvidence to return: A file reference.",
  })).task;
  const claim = async (id) => (await call(worker, "claim_task", { id })).task;
  const finish = async (task) => (await call(worker, "transition_task", { id: task.id, action: "complete" })).task;
  const postResult = async (task) => (await call(worker, "post_message", {
    channel, thread: task.thread_id, text: "Result: The task API examples are documented.\nEvidence: README.md, HTTP API section.",
  })).message;

  const normal = await create("Normal handoff");
  await call(coordinator, "create_task", { channel, title: "Unrelated offer", assignee: "coordinator" });
  const { tasks: offers } = await call(worker, "list_tasks", { channel, state: "ready", assignee: "worker" });
  assert.deepEqual(offers.map(({ id }) => id), [normal.id]);
  assert.equal((await claim(normal.id)).claimer, "worker");
  const normalResult = await postResult(normal);
  assert.equal((await finish(normal)).state, "done");
  const { messages } = await call(coordinator, "read_messages", { channel, thread: normal.thread_id });
  assert.deepEqual(messages.map(({ id }) => id), [normal.thread_id, normalResult.id]);

  const competing = await create("Competing claim");
  const accepted = await claim(competing.id);
  for (const [action, error] of [["claim", /ready/], ["release", /current claimer/], ["complete", /current claimer/]]) {
    await call(coordinator, "transition_task", { id: competing.id, action }, error);
  }
  const { tasks: stillClaimed } = await call(coordinator, "list_tasks", { channel, state: "claimed" });
  assert.deepEqual(stillClaimed, [accepted]);
  await postResult(competing);
  assert.equal((await finish(competing)).state, "done");

  const interrupted = await create("Interrupted handoff");
  await claim(interrupted.id);
  const existingResult = await postResult(interrupted);
  const { tasks: coordinatorOffers } = await call(coordinator, "list_tasks", { channel, assignee: "coordinator" });
  await call(coordinator, "transition_task", { id: coordinatorOffers[0].id, action: "claim" });
  await call(coordinator, "post_message", { channel, text: "Unrelated channel message" });

  await worker.close();
  worker = await connect("worker-reconnected", workerToken);
  const { tasks: recovered } = await call(worker, "list_tasks", { channel, state: "claimed", claimer: "worker" });
  assert.deepEqual(recovered.map(({ id }) => id), [interrupted.id]);
  const { messages: replies } = await call(worker, "read_messages", {
    channel, thread: recovered[0].thread_id, after: recovered[0].thread_id,
  });
  assert.deepEqual(replies.map(({ id }) => id), [existingResult.id]);
  assert.equal((await finish(recovered[0])).state, "done");
  const { tasks: finished } = await call(coordinator, "list_tasks", { channel, state: "done", claimer: "worker" });
  assert.deepEqual(finished.map(({ id }) => id), [normal.id, competing.id, interrupted.id]);
  console.log(`Handoff smoke passed: normal, competing claim, and reconnect without reposting (${board}).`);
} finally {
  await worker?.close();
  await coordinator.close();
}
