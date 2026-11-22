import type { AgentInfo, FileListOutput, ReferenceInfo, SessionInfo, SessionPromptInput, SkillInfo } from "@opencode/client"
import { Schema } from "effect"
import fuzzysort from "fuzzysort"

export const ContextMention = Schema.Struct({
  type: Schema.Literals(["file", "skill", "agent", "session"]),
  value: Schema.String,
  label: Schema.String,
})
// Strings are file mentions saved by earlier versions.
export type Mention = string | typeof ContextMention.Type
export type MentionOption = { value: string; label: string; description?: string; group: string; mention: Mention }
export const mentionKey = (mention: Mention) => typeof mention === "string" ? `file:${mention}` : `${mention.type}:${mention.value}`
export const mentionLabel = (mention: Mention) => typeof mention === "string" ? mention : mention.label

export function mentionOptions(query: string, input: {
  references: readonly ReferenceInfo[]
  skills: readonly SkillInfo[]
  agents: readonly AgentInfo[]
  sessions: readonly SessionInfo[]
  files: readonly Pick<FileListOutput["data"][number], "path" | "type">[]
  currentID: string
  directory: string
}) {
  const match = (label: string) => label.toLowerCase().includes(query.toLowerCase())
  const option = (type: typeof ContextMention.Type["type"], value: string, label: string, group: string, description?: string): MentionOption =>
    ({ value: `${type}:${value}`, label: type === "file" && group === "Files and folders" ? label : `@${label}`, description, group, mention: { type, value, label } })
  const fixed = [
    ...input.skills.map(skill => option("skill", skill.id, skill.id, "Skills", skill.description)),
    ...input.agents.filter(agent => !agent.hidden && agent.mode !== "primary")
      .map(agent => option("agent", agent.name, agent.name, "Agents", agent.description)),
    ...input.sessions.filter(session => !session.parentID && !session.time.archived && !session.metadata?.desktopSideChatParent &&
      session.id !== input.currentID && (query ? match(session.title ?? "New session") : session.location.directory === input.directory))
      .toSorted((a, b) => b.time.updated - a.time.updated).slice(0, 5)
      .map(session => option("session", session.id, session.title ?? "New session", "Chats", session.location.directory)),
    ...input.references.filter(reference => !reference.hidden)
      .map(reference => option("file", reference.path, reference.name, "References", reference.description ??
        (reference.source.type === "git" ? reference.source.repository : reference.source.path))),
  ]
  const ranked = query ? fuzzysort.go(query, fixed, { keys: ["label"] }).map(result => result.obj) : fixed
  return ["Skills", "Agents", "Chats", "References"].flatMap(group => ranked.filter(item => item.group === group)).concat(
    input.files.map(file => option("file", file.path, file.path, "Files and folders", file.type === "directory" ? "Folder" : undefined)),
  )
}

export function mentionPayload(text: string, mentions: readonly Mention[]) {
  type Span = { start: number; end: number; text: string }
  const files: { path: string; name: string; mention?: Span }[] = []
  const agents: NonNullable<SessionPromptInput["agents"]>[number][] = []
  const skills: NonNullable<SessionPromptInput["skills"]>[number][] = []
  let output = text
  let first = true
  for (const item of new Map(mentions.map(item => [mentionKey(item), item])).values()) {
    if (typeof item === "string") { files.push({ path: item, name: item }); continue }
    output += output ? first ? "\n\n" : " " : ""
    first = false
    const value = item.type === "session" ? `@session:${item.value}` : `@${item.label}`
    const mention = { start: output.length, end: output.length + value.length, text: value }
    output += value
    if (item.type === "file") files.push({ path: item.value, name: item.label, mention })
    if (item.type === "agent") agents.push({ name: item.value, mention })
    if (item.type === "skill") skills.push({ id: item.value, mention })
  }
  return { text: output, files, agents, skills }
}
