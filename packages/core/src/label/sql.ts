import { sql } from "drizzle-orm"
import { foreignKey, index, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { SessionTable } from "../session/sql"
import type { SessionSchema } from "../session/schema"

export const LabelTable = sqliteTable(
  "label",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    parent_id: text(),
    ...Timestamps,
  },
  (table) => [
    index("label_parent_idx").on(table.parent_id),
    uniqueIndex("label_parent_name_unique_idx").on(
      sql`(CASE WHEN ${table.parent_id} IS NULL THEN 0 ELSE 1 END)`,
      sql`(coalesce(${table.parent_id}, ''))`,
      sql`(lower(${table.name}))`,
    ),
    foreignKey({
      columns: [table.parent_id],
      foreignColumns: [table.id],
      name: "label_parent_id_label_id_fk",
    }).onDelete("cascade"),
  ],
)

/** Assigns labels to sessions. Rows disappear when either the session or the label is deleted. */
export const SessionLabelTable = sqliteTable(
  "session_label",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    label_id: text()
      .notNull()
      .references(() => LabelTable.id, { onDelete: "cascade" }),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.label_id] }),
    index("session_label_label_idx").on(table.label_id),
  ],
)
