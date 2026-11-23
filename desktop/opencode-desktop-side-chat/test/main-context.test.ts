import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionMessageInfo } from "@opencode/client"
import { mainContext } from "../src/conversation.ts"
import { readMainContext } from "../src/main-context.ts"
import type { OpenCodeClient } from "@opencode/client"

function assistant(content: unknown[]): SessionMessageInfo {
  return { id: "assistant", type: "assistant", content } as SessionMessageInfo
}

function tool(status: string, extra: object = {}) {
  return { type: "tool", id: "call-1", name: "browser.search", state: { status, input: { query: "customer" }, ...extra } }
}

test("main snapshots retain ordered tool names, call IDs, inputs, outputs and errors", () => {
  const snapshot = mainContext([assistant([
    { type: "text", text: "Before tools" },
    tool("completed", { content: [{ type: "text", text: "Search result" }] }),
    tool("error", { error: { type: "NetworkError", message: "Unavailable", status: 503 }, content: [{ type: "text", text: "Partial result" }] }),
    { type: "text", text: "After tools" },
  ])], [])
  assert.equal(snapshot.main.length, 4)
  assert.equal(snapshot.main[0].text, "Before tools")
  assert.match(snapshot.main[1].text, /Tool: browser.search\nCall ID: call-1\nStatus: completed/)
  assert.match(snapshot.main[1].text, /Input:\n\{"query":"customer"\}/)
  assert.match(snapshot.main[1].text, /Output:\nSearch result/)
  assert.match(snapshot.main[2].text, /Status: error/)
  assert.match(snapshot.main[2].text, /Partial result/)
  assert.match(snapshot.main[2].text, /Error:\nNetworkError: Unavailable \(status 503\)/)
  assert.equal(snapshot.main[3].text, "After tools")
})

test("tool-only snapshots include running and partial streaming inputs without hidden reasoning", () => {
  const snapshot = mainContext([assistant([
    { type: "reasoning", text: "PRIVATE_REASONING" },
    tool("running"),
    tool("streaming", { input: '{"query":"par' }),
  ])], [])
  assert.equal(snapshot.main.length, 2)
  assert.match(snapshot.main[0].text, /Status: running/)
  assert.match(snapshot.main[1].text, /Status: streaming\n\nInput:\n\{"query":"par/)
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_REASONING"))
})

test("file outputs retain metadata and references while omitting inline payloads", () => {
  const snapshot = mainContext([assistant([tool("completed", {
    input: { image: "data:image/png;base64,INPUT_SECRET" },
    content: [
      { type: "file", name: "screen.png", mime: "image/png", uri: "data:image/png;base64,OUTPUT_SECRET" },
      { type: "file", mime: "image/png", uri: "blob:OUTPUT_SECRET" },
      { type: "file", name: "report.pdf", mime: "application/pdf", uri: "file:///tmp/report.pdf" },
    ],
  })])], [])
  const text = snapshot.main[0].text
  assert.match(text, /screen.png \(image\/png\)/)
  assert.match(text, /report.pdf \(application\/pdf\)\nfile:\/\/\/tmp\/report.pdf/)
  assert.match(text, /\[inline data omitted\]/)
  assert.ok(!text.includes("SECRET"))
})

test("large tool results preserve input/status/error and keep the main excerpt within its budget", () => {
  const message = assistant([tool("error", {
    input: { query: "INPUT_START" + "x".repeat(40_000) + "INPUT_END" },
    content: Array.from({ length: 100 }, () => ({ type: "text", text: "RESULT_START" + "y".repeat(40_000) + "RESULT_END" })),
    error: { type: "ToolError", message: "ERROR_START" + "z".repeat(40_000) + "ERROR_END" },
  })])
  const single = mainContext([message], []).main[0].text
  for (const value of ["browser.search", "Status: error", "INPUT_START", "INPUT_END", "RESULT_START", "RESULT_END", "ERROR_START", "ERROR_END", "truncated"]) assert.ok(single.includes(value), value)
  assert.ok(single.length < 8_000)
  const snapshot = mainContext(Array.from({ length: 30 }, () => message), [])
  assert.ok(snapshot.main.reduce((size, line) => size + line.text.length + (line.files?.join("").length ?? 0) + 90, 0) <= 30_000)
  assert.ok(snapshot.main.length < 30)
})

test("snapshot still includes user attachments, completed compaction, standalone shell and legacy side history", () => {
  const messages = [
    { id: "u", type: "user", text: "Question", files: [{ name: "input.pdf" }] },
    { id: "c", type: "compaction", status: "completed", summary: "Earlier context" },
    { id: "s", type: "shell", command: "printf hello", output: { output: "hello" } },
  ] as SessionMessageInfo[]
  const snapshot = mainContext(messages, [{ question: "Old question", answer: "Old answer" }])
  assert.deepEqual(snapshot.main.map(line => line.text), ["Question", "Earlier context", "$ printf hello\nhello"])
  assert.deepEqual(snapshot.main[0].files, ["input.pdf"])
  assert.deepEqual(snapshot.earlierSideChat.map(line => line.text), ["Old question", "Old answer"])
})

test("descendant snapshots paginate and follow nested native parents, excluding side chats and repeated sessions", async () => {
  const signal = new AbortController().signal
  const fetched: string[] = []
  const listed: string[] = []
  const child = (id: string, parentID: string) => ({ id, parentID, agent: `${id}-agent`, title: `${id} task` })
  const client = { session: {
    context: async ({ sessionID }, options) => {
      assert.equal(options.signal, signal)
      fetched.push(sessionID)
      return [assistant([tool(sessionID === "nested" ? "running" : "completed", { content: [{ type: "text", text: `${sessionID} result` }] })])]
    },
    list: async ({ parentID, cursor, archived }, options) => {
      assert.equal(options.signal, signal)
      listed.push(`${parentID}:${archived}:${cursor ?? "first"}`)
      if (archived) return { data: parentID === "root" ? [child("archived", "root")] : [], cursor: {} }
      if (parentID === "root" && !cursor) return { data: [child("first", "root"), { ...child("side", "root"), metadata: { desktopSideChatParent: "root" } }, child("unrelated", "other")], cursor: { next: "page2" } }
      if (parentID === "root") return { data: [child("second", "root"), child("first", "root")], cursor: {} }
      if (parentID === "first") return { data: [child("nested", "first")], cursor: {} }
      if (parentID === "nested") return { data: [child("root", "nested")], cursor: {} }
      return { data: [], cursor: {} }
    },
  } } as unknown as OpenCodeClient
  const snapshot = await readMainContext(client, "root", [], signal)
  assert.deepEqual(fetched, ["root", "first", "second", "archived", "nested"])
  assert.ok(listed.includes("root:false:page2"))
  assert.ok(listed.includes("root:true:first"))
  const text = JSON.stringify(snapshot.main)
  assert.match(text, /Sub-agent: first-agent; title: first task; session: first; parent: root/)
  assert.match(text, /Sub-agent: nested-agent; title: nested task; session: nested; parent: first/)
  assert.match(text, /Status: running/)
  assert.ok(!text.includes("side-agent"))
})

test("descendant capture caps fetches, labels omitted coverage and shares the main context budget", async () => {
  let fetched = 0
  const client = { session: {
    context: async () => { fetched++; return [assistant([tool("completed", { content: [{ type: "text", text: "x".repeat(40_000) }] })])] },
    list: async () => ({ data: Array.from({ length: 100 }, (_, i) => ({ id: `child-${i}`, parentID: "root", agent: "worker" })), cursor: {} }),
  } } as unknown as OpenCodeClient
  const snapshot = await readMainContext(client, "root", [], new AbortController().signal)
  assert.equal(fetched, 25)
  assert.match(snapshot.note, /24-session limit/)
  assert.ok(snapshot.main.reduce((size, line) => size + line.text.length + 90, 0) <= 30_000)
  assert.ok(snapshot.main.every(line => line.text.includes("Sub-agent: worker")))
})

test("descendant API failures surface instead of silently reporting a complete snapshot", async () => {
  const client = { session: {
    context: async ({ sessionID }) => { if (sessionID === "child") throw new Error("Child context unavailable"); return [] },
    list: async () => ({ data: [{ id: "child", parentID: "root" }], cursor: {} }),
  } } as unknown as OpenCodeClient
  await assert.rejects(readMainContext(client, "root", [], new AbortController().signal), /Child context unavailable/)
})
