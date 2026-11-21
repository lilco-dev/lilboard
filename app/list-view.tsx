import Form from "next/form";
import Link from "next/link";
import { Badge, EmptyState } from "@lilco/ui";
import { listMessages } from "@/lib/core";
import { type BoardList, type ListItem } from "@/lib/lists";
import { DateStamp, MessageList, ViewTitle, type WorkspaceHref } from "./views";
import styles from "./board.module.css";

export function filterOptions(list: BoardList) {
  return Object.entries(list.schema.properties).flatMap(([field, definition]) =>
    (definition.enum ?? []).map((value) => ({
      field,
      value,
      id: JSON.stringify([field, value]),
      label: `${definition.title ?? field}: ${value}`,
    })),
  );
}

type Filter = ReturnType<typeof filterOptions>[number];

function ItemValue({ value, format }: { value: ListItem["fields"][string] | undefined; format?: "uri" }) {
  if (value === undefined || value === "") return <>—</>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "string" && format === "uri" && /^https?:\/\//i.test(value)) {
    return <a href={value} rel="noreferrer">{value}</a>;
  }
  return <>{value}</>;
}

export function ListView({ list, items, board, filter, before, selected, href }: {
  list: BoardList;
  items: ListItem[];
  board: string;
  filter?: Filter;
  before?: number;
  selected?: number;
  href: WorkspaceHref;
}) {
  const choices = filterOptions(list);
  return (
    <>
      <ViewTitle title={list.title}>{list.schema.description ?? "Items in this list. Open a row for details and discussion."}</ViewTitle>
      {choices.length > 0 && (
        <Form action="/" className={styles.filters} aria-label="Filter items" key={filter?.id ?? "all"}>
          <input type="hidden" name="board" value={board} />
          <input type="hidden" name="channel" value={list.channel} />
          <label>
            <span className="lil-eyebrow">Filter</span>
            <select name="filter" defaultValue={filter?.id ?? ""}>
              <option value="">All items</option>
              {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
          </label>
          <button type="submit">Apply filter</button>
          {filter && <Link href={href({ filter: undefined, before: undefined })}>Clear filter</Link>}
        </Form>
      )}
      <div className={styles.panel}>
        {items.length === 0 ? (
          <EmptyState title="No items">{filter ? "No items match this filter." : "Items added by people or agents will show up here."}</EmptyState>
        ) : (
          <div className={styles.listScroll} tabIndex={0} role="region" aria-label={list.title}>
            <table className={styles.listTable} role="table" aria-label={list.title}>
              <thead role="rowgroup"><tr role="row">{list.columns.map((name) => (
                <th role="columnheader" scope="col" key={name}>{list.schema.properties[name].title ?? name}</th>
              ))}</tr></thead>
              <tbody role="rowgroup">{items.map((item) => (
                <tr role="row" key={item.id} data-selected={item.id === selected ? "" : undefined}>
                  {list.columns.map((name) => {
                    const column = list.schema.properties[name];
                    const value = item.fields[name];
                    return <td role="cell" key={name}>{name === "title" ? (
                      <Link prefetch={false} href={href({ item: String(item.id) })} aria-current={item.id === selected ? "true" : undefined}>{value}</Link>
                    ) : (
                      <>
                        <span className={styles.listFieldLabel} aria-hidden="true">{column.title ?? name}</span>
                        {column.enum && value !== undefined ? <Badge>{value}</Badge> : <ItemValue value={value} format={column.format} />}
                      </>
                    )}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {before !== undefined && <Link className={styles.older} href={href({ before: String(before) })}>Older items →</Link>}
    </>
  );
}

export function ListItemDetail({ list, item, board }: { list: BoardList; item: ListItem; board: string }) {
  const replies = listMessages({ board, channel: list.channel, thread: item.id, latest: true, limit: 50 })
    .filter((message) => message.id !== item.id).toReversed();

  return (
    <div className={styles.taskDetail}>
      <h3>{item.fields.title}</h3>
      <dl className={styles.itemFields}>
        {Object.entries(list.schema.properties).filter(([name]) => name !== "title").map(([name, field]) => (
          <div key={name}>
            <dt>{field.title ?? name}</dt>
            <dd><ItemValue value={item.fields[name]} format={field.format} /></dd>
          </div>
        ))}
      </dl>
      <p className={styles.meta}>Updated by {item.updated_by} · <DateStamp value={item.updated_at} /></p>
      <h3 className={`lil-eyebrow ${styles.listThread}`}>Discussion</h3>
      <MessageList messages={replies} />
    </div>
  );
}
