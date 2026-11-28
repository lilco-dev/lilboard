#!/usr/bin/env node
// lilboard CLI — mirrors the vercel board command surface against a lilboard server.
//
//   lilboard read <channel> [--after id] [--label k=v]
//   lilboard post <channel> <text> [--label k=v] [--profile name]
//   lilboard poll [--since id] [--timeout s] [--mentions name]
//   lilboard tasks create <channel> <title>
//   lilboard tasks claim [--channel c]
//   lilboard tasks done <id>
//
// Config: LILBOARD_URL (default http://localhost:3000), LILBOARD_TOKEN,
// LILBOARD_BOARD (default "general").

const URL_BASE = (process.env.LILBOARD_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.LILBOARD_TOKEN;
const BOARD = process.env.LILBOARD_BOARD ?? "general";

function headers(json = false) {
  const h = {};
  if (json) h["content-type"] = "application/json";
  if (TOKEN) h["authorization"] = `Bearer ${TOKEN}`;
  if (process.env.LILBOARD_PROFILE) h["x-board-profile"] = process.env.LILBOARD_PROFILE;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(`${URL_BASE}/api/boards/${BOARD}${path}`, {
    ...opts,
    headers: { ...headers(opts.body != null), ...(opts.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`error ${res.status}: ${data.error ?? res.statusText}`);
    process.exit(1);
  }
  return data;
}

// Dependency-free aligned columns, charm-style. No colors, so widths are honest.
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const row of rows) console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd());
}

function fmtMessage(m) {
  const labels = Object.entries(m.labels ?? {})
    .map(([k, v]) => ` ${k}=${v}`)
    .join("");
  return `[${m.id}] ${new Date(m.created_at).toISOString()} ${m.display}: ${m.body}${labels}`;
}

const [cmd, sub, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

switch (cmd) {
  case "read": {
    const channel = sub;
    const qs = new URLSearchParams();
    if (flag("after")) qs.set("after", flag("after"));
    if (flag("label")) qs.set("label", flag("label"));
    const { messages } = await api(`/channels/${channel}/messages?${qs}`);
    for (const m of messages) console.log(fmtMessage(m));
    break;
  }
  case "post": {
    const channel = sub;
    const text = rest.filter((a) => !a.startsWith("--")).join(" ");
    const labels = {};
    const li = rest.indexOf("--label");
    if (li >= 0) {
      const [k, v] = rest[li + 1].split("=");
      labels[k] = v ?? "";
    }
    const { message } = await api(`/channels/${channel}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, labels }),
    });
    console.log(fmtMessage(message));
    break;
  }
  case "poll": {
    let since = flag("since") ?? "0";
    const timeout = flag("timeout") ?? "25";
    const mentions = flag("mentions");
    for (;;) {
      const { events, cursor } = await api(`/poll?since=${since}&timeout=${timeout}`);
      since = cursor;
      for (const e of events) {
        if (e.kind !== "message" || !e.channel) continue;
        const { messages } = await api(`/channels/${e.channel}/messages?after=${e.ref_id - 1}&limit=1`);
        const m = messages[0];
        if (!m) continue;
        if (mentions && !m.body.includes(`@${mentions}`) && m.display !== mentions) continue;
        console.log(`#${e.channel} ${fmtMessage(m)}`);
      }
    }
    break;
  }
  case "tasks": {
    if (sub === "create") {
      const channel = rest[0];
      const title = rest.slice(1).filter((a) => !a.startsWith("--")).join(" ");
      const { task } = await api(`/tasks`, { method: "POST", body: JSON.stringify({ channel, title }) });
      console.log(`task #${task.id} ready in ${task.channel}: ${task.title}`);
    } else if (sub === "claim") {
      const ch = flag("channel");
      const { task } = await api(`/tasks/claim${ch ? `?channel=${ch}` : ""}`, { method: "POST", body: "{}" });
      if (!task) console.log("no ready tasks");
      else console.log(`claimed #${task.id}: ${task.title}`);
    } else if (sub === "done" || sub === "complete") {
      const { task } = await api(`/tasks/${rest[0]}`, { method: "POST", body: JSON.stringify({ action: "complete" }) });
      console.log(`done #${task.id}: ${task.title}`);
    } else if (sub === "list" || sub === undefined) {
      const state = flag("state") ?? "ready";
      const { tasks } = await api(`/tasks?state=${state}`);
      table([["ID", "STATE", "CHANNEL", "TITLE", "CLAIMER"],
        ...tasks.map((t) => [`#${t.id}`, t.state, t.channel, t.title, t.claimer ?? ""])]);
    } else {
      console.error(`unknown tasks subcommand: ${sub}`);
      process.exit(1);
    }
    break;
  }
  default:
    console.log(`usage: lilboard <read|post|poll|tasks> ...`);
    console.log(`  env: LILBOARD_URL LILBOARD_TOKEN LILBOARD_PROFILE LILBOARD_BOARD`);
    process.exit(cmd ? 1 : 0);
}
