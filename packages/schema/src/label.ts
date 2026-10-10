export * as Label from "./label"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { optional, statics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Label.ID"),
  statics((schema) => ({ create: () => schema.make("lbl_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  /** Parent label, or undefined for a top-level label. */
  parentID: optional(ID),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "Label.Info" })
export type Info = typeof Info.Type

export const CreateInput = Schema.Struct({
  name: Schema.String,
  parentID: optional(ID),
}).annotate({ identifier: "Label.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const ListInput = Schema.Struct({
  /**
   * `undefined` lists every label, `null` lists only top-level labels,
   * and an ID lists the direct children of that label.
   */
  parentID: optional(Schema.NullOr(ID)),
}).annotate({ identifier: "Label.ListInput" })
export type ListInput = typeof ListInput.Type

export const UpdateInput = Schema.Struct({
  name: optional(Schema.String),
  /** `undefined` leaves the parent unchanged, `null` moves the label to the top level. */
  parentID: optional(Schema.NullOr(ID)),
}).annotate({ identifier: "Label.UpdateInput" })
export type UpdateInput = typeof UpdateInput.Type
