import type { Task, TaskState } from "./core";
import { db, DEFAULT_BOARD } from "./db";

export function listSpaces(current: string): string[] {
  // SAFETY: SELECT DISTINCT board returns one named column per row.
  const rows = db.prepare("SELECT DISTINCT board FROM channels").all() as { board: unknown }[];
  const names = rows.flatMap(({ board }) => typeof board === "string" ? [board] : []);
  return [...new Set([DEFAULT_BOARD, current, ...names])].sort((a, b) => a.localeCompare(b));
}

export const taskPageSize = 50;

export type TaskLabel = { key: string; value: string };
export type WorkspaceTask = Task & { labels: Record<string, string> };

export function queueTasks({
  board,
  state,
  channel,
  label,
  before,
}: {
  board: string;
  state?: TaskState;
  channel?: string;
  label?: TaskLabel;
  before?: number;
}): WorkspaceTask[] {
  // SAFETY: the task schema defines t.*; SQLite's JSON aggregate returns text, including '{}' when empty.
  const rows = db.prepare(`
    SELECT t.*, (SELECT json_group_object(l.key, l.value) FROM labels l
      WHERE l.message_id = t.thread_id AND l.key != 'state') AS labels_json
    FROM tasks t
    WHERE t.board = $board
      AND ($state IS NULL OR t.state = $state)
      AND ($channel IS NULL OR t.channel = $channel)
      AND ($before IS NULL OR t.id < $before)
      AND ($key IS NULL OR EXISTS (
        SELECT 1 FROM labels l WHERE l.message_id = t.thread_id AND l.key = $key AND l.value = $value
      ))
    ORDER BY t.id DESC LIMIT $limit
  `).all({
    $board: board,
    $state: state ?? null,
    $channel: channel ?? null,
    $before: before ?? null,
    $key: label?.key ?? null,
    $value: label?.value ?? null,
    $limit: taskPageSize + 1,
  }) as unknown as (Task & { labels_json: string })[];
  return rows.map(({ labels_json, ...task }) => ({ ...task, labels: JSON.parse(labels_json) }));
}

export function taskLabels(board: string): TaskLabel[] {
  // SAFETY: both selected columns are non-null TEXT in the labels schema.
  return db.prepare(`
    SELECT DISTINCT l.key, l.value FROM tasks t
    JOIN labels l ON l.message_id = t.thread_id
    WHERE t.board = ? AND l.key != 'state'
    ORDER BY l.key, l.value
  `).all(board) as unknown as TaskLabel[];
}

export type ActivityItem = {
  id: number;
  kind: string;
  ref_id: number;
  channel: string | null;
  created_at: number;
  body: string | null;
  actor: string | null;
  list_title: string | null;
  item_removed: 0 | 1;
};

export function recentActivity(board: string): ActivityItem[] {
  // shortcut: show the latest 50 events until the workspace needs activity pagination.
  // SAFETY: e.* follows the events schema; both joined columns can be null.
  return db.prepare(`
    SELECT e.*, COALESCE(t.title, m.body, json_extract(i.fields_json, '$.title')) AS body,
      COALESCE(m.actor, CASE WHEN e.kind = 'list_item_removed' THEN r.actor END) AS actor,
      l.title AS list_title, r.id IS NOT NULL AS item_removed
    FROM events e
    LEFT JOIN tasks t ON e.kind = 'task' AND t.id = e.ref_id AND t.board = e.board
    LEFT JOIN messages m ON e.kind = 'message' AND m.id = e.ref_id AND m.board = e.board
    LEFT JOIN list_channels l ON l.board = e.board AND l.channel = e.channel
    LEFT JOIN list_items i ON e.kind IN ('list_item', 'list_item_removed')
      AND i.id = e.ref_id AND i.board = e.board AND i.channel = e.channel
    LEFT JOIN list_item_removals r ON r.id = i.id
    WHERE e.board = ?
    ORDER BY e.id DESC LIMIT 50
  `).all(board) as unknown as ActivityItem[];
}
