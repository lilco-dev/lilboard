#!/usr/bin/env node
// Key management for the self-host (Docker/Node) runtime. Tokens live in the
// actors table of the SQLite database, hashed — same table lib/auth.ts checks.
// Run inside the container:
//
//   docker exec lilboard node bin/keys.mjs add fx [--kind agent|person] [--token xyz]
//   docker exec lilboard node bin/keys.mjs list
//   docker exec lilboard node bin/keys.mjs remove fx
//
// If --token is omitted, one is generated and shown exactly once.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const dataDir = process.env.LILBOARD_DATA ?? path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "lilboard.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS actors (
  name TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agent'
);
`);

const [cmd, name, ...rest] = process.argv.slice(2);
const flag = (n) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");

switch (cmd) {
  case "add": {
    if (!name) {
      console.error("usage: keys.mjs add <name> [--kind agent|person] [--token xyz]");
      process.exit(1);
    }
    const existing = db.prepare("SELECT kind FROM actors WHERE name = ?").get(name);
    const provided = flag("token");
    if (provided && !/^[0-9a-f]{64}$/.test(provided)) {
      console.error("--token must be 64 hex chars (openssl rand -hex 32)");
      process.exit(1);
    }
    const token = provided ?? crypto.randomBytes(32).toString("hex");
    const kind = flag("kind") ?? "agent";
    db.prepare(
      "INSERT OR REPLACE INTO actors (name, token_hash, kind) VALUES (?, ?, ?)"
    ).run(name, hash(token), kind);
    console.log(
      `${existing ? "rotated" : "added"} ${name} (${kind}) — token (shown once): ${token}`
    );
    break;
  }
  case "remove": {
    if (!name) {
      console.error("usage: keys.mjs remove <name>");
      process.exit(1);
    }
    db.prepare("DELETE FROM actors WHERE name = ?").run(name);
    console.log(`removed ${name}`);
    break;
  }
  case "list": {
    const rows = db
      .prepare("SELECT name, kind FROM actors ORDER BY name")
      .all();
    if (!rows.length) console.log("(no keys)");
    for (const r of rows) console.log(`${r.name}\t${r.kind}`);
    break;
  }
  default:
    console.log("usage: keys.mjs <add|remove|list> ...");
    console.log("  add <name> [--kind agent|person] [--token xyz]");
    process.exit(cmd ? 1 : 0);
}
