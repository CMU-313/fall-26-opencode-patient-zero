import { Label } from "@opencode-ai/schema/label"
import { Session } from "@opencode-ai/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, LabelNotFoundError, SessionNotFoundError } from "../errors"

const Response = Schema.Struct({ data: Label.Info }).annotate({ identifier: "LabelResponse" })
const SessionLabelsResponse = Schema.Struct({ data: Schema.Array(Label.Info) }).annotate({
  identifier: "SessionLabelsResponse",
})

// Inline payload structs so generated SDKs take body fields directly instead of a wrapper parameter.
const CreatePayload = Schema.Struct(Label.CreateInput.fields)
const UpdatePayload = Schema.Struct(Label.UpdateInput.fields)

// Query strings cannot carry `null`, so "root" stands in for `Label.ListInput`'s top-level filter.
export const LabelsQuery = Schema.Struct({
  parentID: Schema.Union([Schema.Literal("root"), Label.ID]).pipe(Schema.optional),
}).annotate({ identifier: "LabelsQuery" })

export const LabelGroup = HttpApiGroup.make("server.label")
  .add(
    HttpApiEndpoint.get("label.list", "/api/label", {
      query: LabelsQuery,
      success: Schema.Struct({ data: Schema.Array(Label.Info) }).annotate({ identifier: "LabelsResponse" }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.label.list",
        summary: "List labels",
        description:
          "Retrieve labels sorted by name. Omit parentID for every label, pass parentID=root for top-level labels, or pass a label ID for its direct children.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("label.get", "/api/label/:labelID", {
      params: { labelID: Label.ID },
      success: Response,
      error: LabelNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.label.get",
        summary: "Get label",
        description: "Retrieve a label by ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("label.create", "/api/label", {
      payload: CreatePayload,
      success: Response,
      error: [LabelNotFoundError, InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.label.create",
        summary: "Create label",
        description:
          "Create a label, optionally nested under a parent label. Sibling names must be unique, ignoring case.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("label.update", "/api/label/:labelID", {
      params: { labelID: Label.ID },
      payload: UpdatePayload,
      success: Response,
      error: [LabelNotFoundError, InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.label.update",
        summary: "Update label",
        description:
          "Rename a label or move it under another parent. Pass parentID=null to move it to the top level. Moving a label beneath itself or one of its descendants is rejected.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("label.remove", "/api/label/:labelID", {
      params: { labelID: Label.ID },
      success: Schema.Struct({ data: Schema.Array(Label.ID) }).annotate({ identifier: "LabelRemoveResponse" }),
      error: LabelNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.label.remove",
        summary: "Remove label",
        description: "Delete a label and every label nested beneath it. Returns the IDs of all deleted labels.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.label.list", "/api/session/:sessionID/label", {
      params: { sessionID: Session.ID },
      success: SessionLabelsResponse,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.label.list",
        summary: "List session labels",
        description: "Retrieve the labels assigned to a session, sorted by name.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("session.label.assign", "/api/session/:sessionID/label/:labelID", {
      params: { sessionID: Session.ID, labelID: Label.ID },
      success: SessionLabelsResponse,
      error: [LabelNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.label.assign",
        summary: "Assign session label",
        description:
          "Assign a label to a session. Assigning a label the session already has is a no-op. Returns the session's labels.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("session.label.unassign", "/api/session/:sessionID/label/:labelID", {
      params: { sessionID: Session.ID, labelID: Label.ID },
      success: SessionLabelsResponse,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.label.unassign",
        summary: "Unassign session label",
        description:
          "Remove a label from a session. Removing a label the session does not have is a no-op. Returns the session's labels.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "label", description: "Hierarchical label management routes." }))
