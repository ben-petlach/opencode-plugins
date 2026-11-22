import assert from "node:assert/strict"
import { test } from "node:test"
import { Schema } from "effect"
import type { AgentInfo, ReferenceInfo, SessionInfo, SkillInfo } from "@opencode/client"
import type { MountedSession } from "@opencode/plugin/gui"
import { ContextMention, mentionKey, mentionLabel, mentionOptions, mentionPayload, type Mention } from "../src/mentions.ts"
import { prepareFiles } from "../src/attachments.ts"

const skill = (id: string) => ({ id, name: id, description: "Skill description" }) as SkillInfo
const reference = (name: string, hidden = false) => ({ name, hidden, path: `/refs/${name}`, source: { type: "local", path: `/refs/${name}` } }) as ReferenceInfo
const agent = (name: string, mode = "subagent", hidden = false) => ({ name, mode, hidden }) as AgentInfo
const chat = (id: string, title: string, directory = "/project") => ({ id, title, location: { directory }, time: { updated: 1 } }) as SessionInfo
const input = () => ({
  skills: [skill("slack--slack-search"), skill("slack--slack-messaging"), skill("other")],
  references: [reference("Slack"), reference("Slack-hidden", true)],
  agents: [agent("slack-review"), agent("slack-primary", "primary"), agent("slack-hidden", "subagent", true)],
  sessions: [chat("main", "Slack main"), chat("other", "Slack review")],
  files: Array.from({ length: 12 }, (_, i) => ({ path: `file-${i}`, type: "file" as const })),
  currentID: "main", directory: "/project",
})

test("@Slack offers matching native skills, references, agents and chats alongside files", () => {
  const options = mentionOptions("SLACK", input())
  assert.deepEqual(options.slice(0, 5).map(option => option.label), [
    "@slack--slack-search", "@slack--slack-messaging", "@slack-review", "@Slack review", "@Slack",
  ])
  assert.equal(options.filter(option => option.group === "Files and folders").length, 12)
  assert.equal(options.find(option => option.label === "@Slack")?.mention.value, "/refs/Slack")
  assert.ok(!options.some(option => /hidden|primary|@other$|Slack main/.test(option.label)))
})

test("bare @ scopes recent chats locally and excludes archived, child and side-chat sessions", () => {
  const source = input()
  source.sessions.push(chat("remote", "Remote", "/elsewhere"),
    { ...chat("archived", "Archived"), time: { updated: 2, archived: 3 } },
    { ...chat("child", "Child"), parentID: "main" },
    { ...chat("side", "Side chat"), metadata: { desktopSideChatParent: "main" } })
  assert.deepEqual(mentionOptions("", source).filter(option => option.group === "Chats").map(option => option.mention.value), ["other"])
  assert.equal(mentionOptions("remote", source).find(option => option.group === "Chats")?.mention.value, "remote")
})

test("old drafts remain valid and file deduplication also recognizes new file mentions", () => {
  const decode = Schema.decodeUnknownSync(Schema.Array(Schema.Union([Schema.String, ContextMention])))
  const draft = decode(["old.txt", { type: "skill", value: "slack--slack-search", label: "slack--slack-search" }])
  assert.equal(mentionLabel(draft[0]), "old.txt")
  assert.equal(mentionKey("old.txt"), mentionKey({ type: "file", value: "old.txt", label: "old.txt" }))
  const payload = mentionPayload("Keep this draft", ["old.txt", "old.txt"])
  assert.equal(payload.text, "Keep this draft")
  assert.deepEqual(payload.files, [{ path: "old.txt", name: "old.txt" }])
})

test("mentions reach native request fields with exact text offsets and encoded paths", async () => {
  const mentions: Mention[] = ["legacy.txt",
    { type: "file", value: "/references/Slack guide", label: "Slack" },
    { type: "skill", value: "slack--slack-search", label: "slack--slack-search" },
    { type: "agent", value: "review", label: "review" },
    { type: "session", value: "ses_123", label: "Earlier discussion" }]
  const payload = mentionPayload("Please check this", mentions)
  assert.equal(payload.text, "Please check this\n\n@Slack @slack--slack-search @review @session:ses_123")
  assert.equal(payload.skills[0].id, "slack--slack-search")
  assert.equal(payload.agents[0].name, "review")
  for (const item of [...payload.files, ...payload.skills, ...payload.agents]) {
    if (item.mention) assert.equal(payload.text.slice(item.mention.start, item.mention.end), item.mention.text)
  }
  const files = await prepareFiles({ directory: "/project", server: {} } as MountedSession,
    payload.files, [], [], new AbortController().signal)
  assert.deepEqual(files.map(file => [file.uri, file.name]), [
    ["file:///project/legacy.txt", "legacy.txt"], ["file:///references/Slack%20guide", "Slack"],
  ])
  assert.deepEqual(files[1].mention, payload.files[1].mention)
  assert.equal(mentionPayload("", [mentions[2]]).text, "@slack--slack-search")
})
