import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, Inspector, Masthead, NavGroup, NavLink, Workspace } from "@lilco/ui";
import { getTask, latestEventId, listChannels, listMessages, type TaskState } from "@/lib/core";
import { DEFAULT_BOARD } from "@/lib/db";
import { defaultChannel, getItem, getList, listChannelsWithSchema, readItems } from "@/lib/lists";
import { listSpaces, queueTasks, recentActivity, taskLabels } from "@/lib/workspace";
import { CommandPalette, type Destination } from "./command-palette";
import { filterOptions, ListItemDetail, ListView } from "./list-view";
import { Activity, MessageList, TaskDetail, Tasks, ViewTitle, labelValue, type WorkspaceHref } from "./views";
import { LiveBoard } from "./live-board";
import { SpaceSwitcher } from "./space-switcher";
import styles from "./board.module.css";

function text(value: string | string[] | undefined) {
  return typeof value === "string" && value ? value : undefined;
}

function positiveId(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<main className={styles.loading} role="status">Loading lilboard…</main>}>
      <Board searchParams={searchParams} />
    </Suspense>
  );
}

async function Board({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const params = await searchParams;
  const board = text(params.board) ?? DEFAULT_BOARD;
  // Read the cursor first so changes during this render get replayed on connect.
  const cursor = latestEventId(board);
  const channel = text(params.channel);
  const view = text(params.view);
  const room = view === "tasks" || view === "activity" ? undefined : channel ?? defaultChannel(board);
  const section = view === "activity" ? "activity" : room ? "room" : "tasks";
  const lists = listChannelsWithSchema(board);
  const listPaths = new Set(lists.map((list) => list.channel));
  const channels = listChannels(board).filter(({ path }) => !listPaths.has(path));
  const list = room ? getList(board, room) : null;
  const href: WorkspaceHref = (query = {}) => {
    const url = new URLSearchParams({ board });
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.set(key, value);
    }
    return `?${url}`;
  };
  const status = text(params.state);
  const state: TaskState | undefined = status === "ready" || status === "claimed" || status === "done"
    ? status
    : undefined;
  const labels = section === "tasks" ? taskLabels(board) : [];
  const label = labels.find((item) => labelValue(item) === text(params.label));
  const filterChannel = channels.find((item) => item.path === channel)?.path;
  const before = positiveId(text(params.before));
  const taskId = section !== "room" ? positiveId(text(params.task)) : undefined;
  const task = taskId === undefined ? null : getTask(taskId);
  const selectedTask = task?.board === board ? task : null;
  const context = section === "tasks" ? {
    view: "tasks",
    state,
    channel: filterChannel,
    label: label && labelValue(label),
    before: before?.toString(),
  } : { view: "activity" };
  const viewHref: WorkspaceHref = (query) => href({ ...context, ...query });
  const selectedItem = list ? positiveId(text(params.item)) : undefined;
  const item = list && selectedItem !== undefined ? getItem(board, list.channel, selectedItem) : null;
  const filter = list ? filterOptions(list).find((option) => option.id === text(params.filter)) : undefined;
  const listHref: WorkspaceHref = (query) => href({ channel: list?.channel, filter: filter?.id, before: before?.toString(), ...query });
  const listPage = list && readItems(board, list.channel, { before, field: filter?.field, value: filter?.value });
  const spaces = listSpaces(board);
  const destinations: Destination[] = [
    { group: "Overview", label: "Tasks", href: href({ view: "tasks" }), shortcut: "g t" },
    { group: "Overview", label: "Activity", href: href({ view: "activity" }), shortcut: "g a" },
    ...spaces.map((space): Destination => ({ group: "Spaces", label: space, href: `?${new URLSearchParams({ board: space })}` })),
    ...channels.map(({ path }): Destination => ({ group: "Chats", label: `#${path}`, href: href({ channel: path }) })),
    ...lists.map(({ channel, title }): Destination => ({ group: "Lists", label: title, href: href({ channel }) })),
  ];

  return (
    <>
      <Masthead brand="lilboard">
        <div className={styles.boardMeta}>
          <LiveBoard key={board} board={board} cursor={cursor} />
          <CommandPalette destinations={destinations} />
        </div>
      </Masthead>
      <Workspace
        navigation={
          <div className={styles.rail}>
            <SpaceSwitcher current={board} spaces={spaces} />
            <NavGroup title="Overview" className={styles.railOverview}>
              <NavLink as={Link} href={href({ view: "tasks" })} current={section === "tasks"}>
                <span className={styles.navMark} aria-hidden="true">▤</span> Tasks
              </NavLink>
              <NavLink as={Link} href={href({ view: "activity" })} current={section === "activity"}>
                <span className={styles.navMark} aria-hidden="true">◷</span> Activity
              </NavLink>
            </NavGroup>
            <NavGroup title="Chats" className={styles.railExtra}>
              {channels.map(({ path }) => (
                <NavLink as={Link} key={path} href={href({ channel: path })} current={room === path}>
                  <span className={styles.navMark} aria-hidden="true">#</span> {path}
                </NavLink>
              ))}
              {channels.length === 0 && <p className={styles.railEmpty}>No chats yet</p>}
            </NavGroup>
            {lists.length > 0 && (
              <NavGroup title="Lists" className={styles.railExtra}>
                {lists.map(({ channel, title }) => (
                  <NavLink as={Link} key={channel} href={href({ channel })} current={room === channel}>
                    <span className={styles.navMark} aria-hidden="true">▦</span> {title}
                  </NavLink>
                ))}
              </NavGroup>
            )}
          </div>
        }
        inspector={list && selectedItem !== undefined ? (
          <Inspector as={Link} heading={`Item #${selectedItem}`} closeHref={listHref()}>
            {item ? <ListItemDetail board={board} list={list} item={item} /> : <EmptyState title="Item not found">This item is not in the current list.</EmptyState>}
          </Inspector>
        ) : taskId !== undefined && (
          <Inspector as={Link} heading={`Task #${taskId}`} closeHref={viewHref()}>
            {selectedTask ? (
              <TaskDetail task={selectedTask} roomHref={href({ channel: selectedTask.channel })} />
            ) : <EmptyState title="Task not found">This task does not belong to this space or no longer exists.</EmptyState>}
          </Inspector>
        )}
      >
        {section === "activity" ? (
          <Activity events={recentActivity(board)} href={href} />
        ) : listPage ? (
          <ListView {...listPage} board={board} filter={filter} selected={selectedItem} href={listHref} />
        ) : room ? (
          <>
            <ViewTitle title={`#${room}`}>Chat · Latest 50 messages</ViewTitle>
            <MessageList messages={listMessages({ board, channel: room, latest: true, limit: 50 }).toReversed()} />
          </>
        ) : (
          <Tasks
            board={board}
            tasks={queueTasks({ board, state, channel: filterChannel, label, before })}
            channels={channels.map(({ path }) => path)}
            labels={labels}
            state={state}
            channel={filterChannel}
            label={label}
            selected={taskId}
            href={viewHref}
          />
        )}
      </Workspace>
    </>
  );
}
