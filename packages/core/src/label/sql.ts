import { foreignKey, index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

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
    foreignKey({
      columns: [table.parent_id],
      foreignColumns: [table.id],
      name: "label_parent_id_label_id_fk",
    }),
  ],
)
