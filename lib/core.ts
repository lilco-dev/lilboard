import { createBoardStore, taskOptions } from "@lilboard/core";
import { nodeSql } from "@lilboard/core/node";
import { db, DEFAULT_BOARD } from "./db";

// Next can load separate copies of this module for REST, MCP, and SSE routes.
type Waiters = Map<string, Set<() => void>>;
const processState = globalThis as typeof globalThis & { lilboardWaiters?: Waiters };
const waiters = (processState.lilboardWaiters ??= new Map());

function notify(board: string) {
  for (const done of waiters.get(board) ?? []) done();
}

export const store = createBoardStore(nodeSql(db), {
  defaultBoard: DEFAULT_BOARD,
  onEmit: notify,
});

export class ListError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function listErrorResponse(error: unknown) {
  if (!(error instanceof ListError)) throw error;
  return Response.json({ error: error.message }, { status: error.status });
}

function isList(board: string, channel: string) {
  return Boolean(db.prepare("SELECT 1 FROM list_channels WHERE board = ? AND channel = ?").get(board, channel));
}

export function postMessage(input: Parameters<typeof store.postMessage>[0]) {
  const board = input.board ?? DEFAULT_BOARD;
  if (isList(board, input.channel) && (
    !Number.isSafeInteger(input.thread) ||
    !db.prepare(`
      SELECT 1 FROM list_items i WHERE board = ? AND channel = ? AND id = ?
      AND NOT EXISTS (SELECT 1 FROM list_item_removals r WHERE r.id = i.id)
    `).get(board, input.channel, input.thread ?? null)
  )) {
    throw new ListError("Add a list item for new records; post messages as replies to an item.");
  }
  return store.postMessage(input);
}

export const getMessage = store.getMessage;
export const listMessages = store.listMessages;
export const listChannels = store.listChannels;
export const listEvents = store.listEvents;
export const latestEventId = store.latestEventId;
export const hasEvents = store.hasEvents;
export function createTask(input: Parameters<typeof store.createTask>[0]) {
  if (isList(input.board ?? DEFAULT_BOARD, input.channel)) throw new ListError("Create tasks in a chat, not in a list.");
  return store.createTask(input);
}
export const getTask = store.getTask;
export const listTasks = store.listTasks;
export { taskOptions };
export const transitionTask = store.transitionTask;
export const nextReady = store.nextReady;
export const claimReady = store.claimReady;

export type { Message, Task, TaskState } from "@lilboard/core";
export type Actor = { actor: string; profile: string | null; kind: string };

export function waitForEvents(board: string, since: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || hasEvents(board, since)) return Promise.resolve();
  return new Promise((resolve) => {
    const boardWaiters = waiters.get(board) ?? new Set<() => void>();
    waiters.set(board, boardWaiters);
    boardWaiters.add(done);
    const timer = setTimeout(done, timeoutMs);
    signal?.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      boardWaiters.delete(done);
      if (boardWaiters.size === 0) waiters.delete(board);
      resolve();
    }
  });
}
