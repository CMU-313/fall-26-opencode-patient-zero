import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260927044105_session_labels",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_label\` (
          \`session_id\` text NOT NULL,
          \`label_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`session_label_pk\` PRIMARY KEY(\`session_id\`, \`label_id\`),
          CONSTRAINT \`fk_session_label_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_label_label_id_label_id_fk\` FOREIGN KEY (\`label_id\`) REFERENCES \`label\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_label_label_idx\` ON \`session_label\` (\`label_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
