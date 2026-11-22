import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, EmptyState } from "@lilco/ui";
import { listMessages, type Message, type Task, type TaskState } from "@/lib/core";
import { taskPageSize, type ActivityItem, type TaskLabel, type WorkspaceTask } from "@/lib/workspace";
import { TaskDensity } from "./task-density";
import styles from "./board.module.css";

export type WorkspaceHref = (params?: Record<string, string | undefined>) => string;

const states = [
  { state: "ready", title: "Ready", tone: "positive" },
  { state: "claimed", title: "Claimed", tone: "attention" },
  { state: "done", title: "Done", tone: "neutral" },
] as const;

const timestamp = new Intl.DateTimeFormat("en", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23", timeZone: "UTC", timeZoneName: "short",
});

export function DateStamp({ value }: { value: number }) {
  const at = new Date(value);
  return <time dateTime={at.toISOString()} title={at.toISOString()}>{timestamp.format(at)}</time>;
}

export function ViewTitle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className={styles.viewTitle}>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}

export function labelValue({ key, value }: TaskLabel) {
  return JSON.stringify([key, value]);
}

function TaskStatus({ state }: { state: TaskState }) {
  const info = states.find((item) => item.state === state);
  return <Badge tone={info?.tone}>{info?.title ?? state}</Badge>;
}

export function Tasks({ board, tasks, channels, labels, state, channel, label, selected, href }: {
  board: string;
  tasks: WorkspaceTask[];
  channels: string[];
  labels: TaskLabel[];
  state?: TaskState;
  channel?: string;
  label?: TaskLabel;
  selected?: number;
  href: WorkspaceHref;
}) {
  const page = tasks.slice(0, taskPageSize);
  const before = tasks.length > taskPageSize ? page.at(-1)?.id : undefined;
  const emptyHint = state || channel || label ? "Try changing the filters." : "Agent tasks will show up here.";
  return (
    <>
      <ViewTitle title="Tasks">Track work across the space. Open a task to see its thread.</ViewTitle>
      <TaskDensity filters={{
        board,
        filters: { state: state ?? "", channel: channel ?? "", label: label ? labelValue(label) : "" },
        statuses: states.map(({ state, title }) => ({ value: state, title })),
        channels,
        labels: labels.map((item) => ({ value: labelValue(item), title: `${item.key}: ${item.value}` })),
      }}>
        <div className={styles.panel}>
          <div className={styles.listHeading}>
            <span>Task</span><span>Status</span>
          </div>
          {page.length === 0 ? (
            <EmptyState title="No tasks">{emptyHint}</EmptyState>
          ) : (
            <ul className={styles.rows} role="list">
              {page.map((task) => (
                <li key={task.id} className={styles.taskRow} data-selected={selected === task.id ? "" : undefined}>
                  <div>
                    <Link prefetch={false} className={styles.taskLink} href={href({ task: String(task.id) })} aria-current={selected === task.id ? "true" : undefined}>
                      {task.title}
                    </Link>
                    <p className={styles.meta}>#{task.id} · #{task.channel}{task.claimer ? ` · ${task.claimer}` : ""}{task.assignee ? ` · for ${task.assignee}` : ""}{task.due ? ` · due ${task.due}` : ""}</p>
                    <div className={styles.labels}>
                      {Object.entries(task.labels).map(([key, value]) => {
                        const id = labelValue({ key, value });
                        return <Link prefetch={false} key={key} href={href({ label: id, before: undefined })}><Badge>{key}: {value}</Badge></Link>;
                      })}
                    </div>
                  </div>
                  <TaskStatus state={task.state} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </TaskDensity>
      {before !== undefined && (
        <Link className={styles.older} href={href({ before: String(before) })}>Older tasks →</Link>
      )}
    </>
  );
}

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className={styles.panel}>
      {messages.length === 0 ? (
        <EmptyState title="No messages yet">New messages will show up here.</EmptyState>
      ) : (
        <ol className={styles.rows} role="list">
          {messages.map((message) => (
            <li key={message.id} className={styles.message}>
              <header>
                <strong>{message.display}</strong>
                <span className={styles.meta}>#{message.id} · <DateStamp value={message.created_at} /></span>
              </header>
              <p className={styles.messageBody}>{message.body}</p>
              {Object.keys(message.labels).length > 0 && (
                <ul className={styles.labels} aria-label="Message labels" role="list">
                  {Object.entries(message.labels).map(([key, value]) => <li key={key}><Badge>{key}: {value}</Badge></li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function TaskDetail({ task, roomHref }: { task: Task; roomHref: string }) {
  const thread = listMessages({
    board: task.board, channel: task.channel, thread: task.thread_id, latest: true, limit: 50,
  }).toReversed();

  return (
    <div className={styles.taskDetail}>
      <h3>{task.title}</h3>
      <div className={styles.detailMeta}>
        <TaskStatus state={task.state} />
        <Link href={roomHref}>#{task.channel}</Link>
      </div>
      {task.description && <p className={styles.messageBody}>{task.description}</p>}
      <dl>
        <div><dt>Owner</dt><dd>{task.claimer ?? "Unassigned"}</dd></div>
        {task.assignee && <div><dt>Assignee</dt><dd>{task.assignee}</dd></div>}
        {task.due && <div><dt>Due</dt><dd>{task.due}</dd></div>}
        <div><dt>Priority</dt><dd>{task.priority}</dd></div>
        <div><dt>Updated</dt><dd><DateStamp value={task.updated_at} /></dd></div>
      </dl>
      <h3 className="lil-eyebrow">Thread <span className={styles.threadLimit}>· Latest 50 messages</span></h3>
      <MessageList messages={thread} />
    </div>
  );
}

const eventNames: Record<string, string> = {
  task: "Task updated", message: "Message posted", list: "List created", list_item: "List item saved",
  list_item_removed: "List item removed",
};

export function Activity({ events, href }: { events: ActivityItem[]; href: WorkspaceHref }) {
  return (
    <>
      <ViewTitle title="Activity">Latest 50 events across the space.</ViewTitle>
      <div className={styles.panel}>
        {events.length === 0 ? (
          <EmptyState title="No activity yet">Messages and task updates will show up here.</EmptyState>
        ) : (
          <ol className={styles.rows} role="list">
            {events.map((event) => (
              <li key={event.id} className={styles.activityRow}>
                <span className={styles.meta}><DateStamp value={event.created_at} /></span>
                <div>
                  <p className={styles.activityKind}>
                    {eventNames[event.kind] ?? event.kind}
                    {event.actor ? ` by ${event.actor}` : ""}
                  </p>
                  {event.kind === "task" ? (
                    <Link href={href({ view: "activity", task: String(event.ref_id) })}>
                      {event.body ?? `Task #${event.ref_id}`}
                    </Link>
                  ) : event.kind === "list_item" && event.channel && !event.item_removed ? (
                    <Link href={href({ channel: event.channel, item: String(event.ref_id) })}>{event.body ?? `Item #${event.ref_id}`}</Link>
                  ) : <p className={styles.eventBody}>{event.body}</p>}
                  {event.channel && (
                    <Link className={styles.eventRoom} href={href({ channel: event.channel })}>
                      {event.list_title ?? `#${event.channel}`}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
