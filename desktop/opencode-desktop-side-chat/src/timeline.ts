import type { SessionMessageInfo } from "@opencode/client"
import { conversationLines, type Line } from "./conversation.ts"

export type ContextUpdate = { id: string; afterID?: string; time: number }
export type Execution = { id: string; label: string; kind: "Execute" | "Thought"; status: string; input?: string; output?: string; error?: string }
export type TimelineRow = { id: string } & (
  { type: "message"; line: Line } | { type: "execution"; entries: Execution[] } | { type: "update"; update: ContextUpdate }
)

// Consecutive tool/thinking records share one disclosure, bounded by visible text, prompts and context updates.
export function timelineRows(messages: readonly SessionMessageInfo[], updates: readonly ContextUpdate[] = []): TimelineRow[] {
  const rows: TimelineRow[] = []
  let group: Extract<TimelineRow, { type: "execution" }> | undefined
  const flush = () => { group = undefined }
  const activity = (entry: Execution) => {
    if (!group) { group = { type: "execution", id: `activity:${entry.id}`, entries: [] }; rows.push(group) }
    group.entries.push(entry)
  }
  const marker = (update: ContextUpdate) => { flush(); rows.push({ type: "update", id: update.id, update }) }
  for (const update of updates.filter(update => !update.afterID)) marker(update)
  for (const message of messages) {
    if (message.type === "assistant") {
      message.content.forEach((part, index) => {
        if (part.type === "text" && part.text.trim()) {
          flush()
          const line: Line = { id: `${message.id}:${index}`, role: "assistant", text: part.text,
            message: { ...message, content: [part] } }
          rows.push({ type: "message", id: line.id, line })
        }
        if (part.type === "reasoning") activity({ id: `${message.id}:${index}`, label: "Thinking", kind: "Thought",
          status: part.time?.completed || message.time.completed ? "completed" : "running", output: part.text })
        if (part.type === "tool") {
          const state = part.state
          const content = "content" in state ? state.content : undefined
          activity({ id: part.id, label: part.name === "shell" ? "Execute" : part.name, kind: "Execute", status: state.status,
            input: "input" in state ? JSON.stringify(state.input, null, 2) : undefined,
            output: content?.map(item => item.type === "text" ? item.text : item.name ?? item.mime).join("\n"),
            error: state.status === "error" ? state.error.message : undefined })
        }
      })
    } else if (message.type === "shell") {
      activity({ id: message.id, label: "Execute", kind: "Execute", status: message.status,
        input: message.command, output: message.output?.output })
    } else {
      const lines = conversationLines([message])
      for (const line of lines) { flush(); rows.push({ type: "message", id: line.id, line }) }
    }
    for (const update of updates.filter(update => update.afterID === message.id)) marker(update)
  }
  return rows
}

export function executionLabel(entries: readonly Execution[]) {
  return (["Execute", "Thought"] as const).flatMap(kind => {
    const count = entries.filter(entry => entry.kind === kind).length
    return count ? [`${count} ${kind}`] : []
  }).join(" · ")
}
export const executing = (entries: readonly Execution[]) => entries.some(entry => ["running", "streaming", "pending"].includes(entry.status))
