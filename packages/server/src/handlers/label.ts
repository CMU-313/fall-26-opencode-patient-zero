import { Label } from "@opencode-ai/core/label"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import {
  ConflictError,
  InvalidRequestError,
  LabelNotFoundError,
  SessionNotFoundError,
} from "@opencode-ai/protocol/errors"

export const LabelHandler = HttpApiBuilder.group(Api, "server.label", (handlers) =>
  Effect.gen(function* () {
    const labels = yield* Label.Service
    return handlers
      .handle(
        "label.list",
        Effect.fn(function* (ctx) {
          const parentID = ctx.query.parentID === "root" ? null : ctx.query.parentID
          return { data: yield* labels.list({ parentID }) }
        }),
      )
      .handle(
        "label.get",
        Effect.fn(function* (ctx) {
          return { data: yield* labels.get(ctx.params.labelID).pipe(Effect.mapError(notFound)) }
        }),
      )
      .handle(
        "label.create",
        Effect.fn(function* (ctx) {
          return { data: yield* labels.create(ctx.payload).pipe(Effect.mapError(httpError)) }
        }),
      )
      .handle(
        "label.update",
        Effect.fn(function* (ctx) {
          return { data: yield* labels.update(ctx.params.labelID, ctx.payload).pipe(Effect.mapError(httpError)) }
        }),
      )
      .handle(
        "label.remove",
        Effect.fn(function* (ctx) {
          return { data: yield* labels.remove(ctx.params.labelID).pipe(Effect.mapError(notFound)) }
        }),
      )
      .handle(
        "session.label.list",
        Effect.fn(function* (ctx) {
          return { data: yield* labels.forSession(ctx.params.sessionID) }
        }),
      )
      .handle(
        "session.label.assign",
        Effect.fn(function* (ctx) {
          yield* labels.assign(ctx.params).pipe(Effect.mapError(assignError))
          return { data: yield* labels.forSession(ctx.params.sessionID) }
        }),
      )
      .handle(
        "session.label.unassign",
        Effect.fn(function* (ctx) {
          yield* labels.unassign(ctx.params)
          return { data: yield* labels.forSession(ctx.params.sessionID) }
        }),
      )
  }),
)

function assignError(error: Label.NotFoundError | Label.SessionNotFoundError) {
  if (error instanceof Label.NotFoundError) return notFound(error)
  return new SessionNotFoundError({ sessionID: error.sessionID, message: error.message })
}

function httpError(error: Label.NotFoundError | Label.InvalidNameError | Label.DuplicateNameError | Label.CycleError) {
  if (error instanceof Label.NotFoundError) return notFound(error)
  if (error instanceof Label.InvalidNameError)
    return new InvalidRequestError({ message: error.message, kind: "invalid_name", field: "name" })
  // Duplicate sibling names and cycles both conflict with the current label tree.
  return new ConflictError({ message: error.message, resource: "label" })
}

function notFound(error: Label.NotFoundError) {
  return new LabelNotFoundError({ labelID: error.id, message: error.message })
}
