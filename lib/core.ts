import { createBoardStore } from "@lilboard/core";
import { nodeSql } from "@lilboard/core/node";
import { db, DEFAULT_BOARD } from "./db";

// long-poll notifier (single-node)
type Waiter = { resolve: () => void };
let waiters: Waiter[] = [];

function notify() {
  for (const w of waiters) w.resolve();
  waiters = [];
}

export const store = createBoardStore(nodeSql(db), {
  defaultBoard: DEFAULT_BOARD,
  onEmit: notify,
});

export const postMessage = store.postMessage;
export const getMessage = store.getMessage;
export const listMessages = store.listMessages;
export const listChannels = store.listChannels;
export const listEvents = store.listEvents;
export const hasEvents = store.hasEvents;
export const createTask = store.createTask;
export const getTask = store.getTask;
export const listTasks = store.listTasks;
export const transitionTask = store.transitionTask;
export const nextReady = store.nextReady;

export type { Message, Task, TaskState } from "@lilboard/core";
export type Actor = { actor: string; profile: string | null };

export function waitForEvents(board: string, since: number, timeoutMs: number): Promise<void> {
  if (hasEvents(board, since)) return Promise.resolve();
  return new Promise((resolve) => {
    const w: Waiter = { resolve };
    waiters.push(w);
    setTimeout(() => {
      waiters = waiters.filter((x) => x !== w);
      resolve();
    }, timeoutMs);
  });
}
