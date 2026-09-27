import { createMemo, createResource, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

type Choice = { type: "label"; id: string } | { type: "create"; name: string }

export function DialogSessionLabel(props: { sessionID: string }) {
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const [query, setQuery] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [labels, { refetch: refetchLabels }] = createResource(async () =>
    (await sdk.client.v2.label.list({}, { throwOnError: true })).data.data,
  )
  const [assigned, { mutate: setAssigned }] = createResource(async () =>
    (await sdk.client.v2.session.label.list({ sessionID: props.sessionID }, { throwOnError: true })).data.data,
  )

  const options = createMemo(() => {
    const all = labels() ?? []
    const byID = new Map(all.map((label) => [label.id, label]))
    // Show nested labels by their full path, such as "Coursework/Databases", so same-named children stay distinct.
    const path = (label: (typeof all)[number]): string => {
      const parent = label.parentID ? byID.get(label.parentID) : undefined
      return parent ? `${path(parent)}/${label.name}` : label.name
    }
    const attached = new Set((assigned() ?? []).map((label) => label.id))
    const name = query().trim()
    const exists = all.some((label) => label.name.toLowerCase() === name.toLowerCase())
    return [
      ...(name && !exists
        ? [{ title: `Create label "${name}"`, value: { type: "create", name } as Choice }]
        : []),
      ...all
        .map((label) => ({
          title: path(label),
          value: { type: "label", id: label.id } as Choice,
          footer: attached.has(label.id) ? (
            <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Assigned</span>
          ) : undefined,
        }))
        .toSorted((a, b) => a.title.localeCompare(b.title)),
    ]
  })

  async function toggle(choice: Choice) {
    if (busy()) return
    setBusy(true)
    try {
      const labelID =
        choice.type === "create"
          ? (await sdk.client.v2.label.create({ labelCreateInput: { name: choice.name } }, { throwOnError: true })).data
              .data.id
          : choice.id
      if (choice.type === "create") await refetchLabels()
      const attached = choice.type === "label" && assigned()?.some((label) => label.id === labelID)
      const next = attached
        ? await sdk.client.v2.session.label.unassign({ sessionID: props.sessionID, labelID }, { throwOnError: true })
        : await sdk.client.v2.session.label.assign({ sessionID: props.sessionID, labelID }, { throwOnError: true })
      setAssigned(next.data.data)
    } catch (error) {
      toast.show({ title: "Updating labels failed", message: errorMessage(error), variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogSelect
      title="Session labels"
      placeholder="Search or create a label"
      options={options()}
      onFilter={setQuery}
      // Keep the dialog open so several labels can be toggled in a row.
      onSelect={(option) => toggle(option.value)}
    />
  )
}
