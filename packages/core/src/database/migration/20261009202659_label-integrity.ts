import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261009202659_label-integrity",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA defer_foreign_keys=ON;`)
      yield* tx.run(`
        CREATE TABLE \`__old_session_label\` (
          \`session_id\` text NOT NULL,
          \`label_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__old_session_label\`(\`session_id\`, \`label_id\`, \`time_created\`, \`time_updated\`) SELECT \`session_id\`, \`label_id\`, \`time_created\`, \`time_updated\` FROM \`session_label\`;`,
      )
      yield* tx.run(`DROP TABLE \`session_label\`;`)
      yield* tx.run(`
        CREATE TABLE \`__new_label\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`parent_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`label_parent_id_label_id_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`__new_label\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_label\`(\`id\`, \`name\`, \`parent_id\`, \`time_created\`, \`time_updated\`) SELECT \`id\`, \`name\`, \`parent_id\`, \`time_created\`, \`time_updated\` FROM \`label\`;`,
      )
      yield* tx.run(`DROP TABLE \`label\`;`)
      yield* tx.run(`ALTER TABLE \`__new_label\` RENAME TO \`label\`;`)
      yield* tx.run(`CREATE INDEX \`label_parent_idx\` ON \`label\` (\`parent_id\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`label_parent_name_unique_idx\` ON \`label\` ((CASE WHEN "parent_id" IS NULL THEN 0 ELSE 1 END),(coalesce("parent_id", '')),(lower("name")));`,
      )
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
      yield* tx.run(
        `INSERT INTO \`session_label\`(\`session_id\`, \`label_id\`, \`time_created\`, \`time_updated\`) SELECT \`session_id\`, \`label_id\`, \`time_created\`, \`time_updated\` FROM \`__old_session_label\`;`,
      )
      yield* tx.run(`CREATE INDEX \`session_label_label_idx\` ON \`session_label\` (\`label_id\`);`)
      yield* tx.run(`DROP TABLE \`__old_session_label\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
