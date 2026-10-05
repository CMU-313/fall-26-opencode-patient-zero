import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260924012642_labels",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`label\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`parent_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`label_parent_id_label_id_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`label\`(\`id\`)
        );
      `)
      yield* tx.run(`CREATE INDEX \`label_parent_idx\` ON \`label\` (\`parent_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
