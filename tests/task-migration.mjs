import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { nodeSql } from "../packages/core/src/adapters/node.ts";
import { migrateTaskColumns, SCHEMA } from "../packages/core/src/schema.ts";

const old = new DatabaseSync(":memory:");
old.exec(`CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL, channel TEXT NOT NULL,
  title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ready', claimer TEXT,
  thread_id INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`);
old.exec("INSERT INTO tasks (board, channel, title, thread_id, created_at, updated_at) VALUES ('general', 'work', 'Existing task', 1, 1, 1)");
migrateTaskColumns(nodeSql(old));
migrateTaskColumns(nodeSql(old));
const row = old.prepare("SELECT description, assignee, due, priority, title FROM tasks WHERE id = 1").get();
assert.deepEqual({ ...row }, { description: null, assignee: null, due: null, priority: "normal", title: "Existing task" });
old.close();

const fresh = new DatabaseSync(":memory:");
fresh.exec(SCHEMA);
migrateTaskColumns(nodeSql(fresh));
assert.equal(fresh.prepare("SELECT priority FROM tasks LIMIT 0").all().length, 0);
fresh.close();
console.log("Task schema migration passed: old rows retained, defaults set, fresh schema unchanged.");
