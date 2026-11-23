import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import server from "../src/server.ts"
import { createInspector } from "../src/tool-inspector.ts"

type Reader = Parameters<typeof createInspector>[0]
type PluginContext = Parameters<typeof server.setup>[0]
type ToolEditor = Parameters<Parameters<PluginContext["tool"]["transform"]>[0]>[0]
type Tool = Parameters<ToolEditor["add"]>[0]
type HookEvent = Parameters<Parameters<PluginContext["session"]["hook"]>[1]>[0]

const bigOutput = `${"x".repeat(21_500)}\nMiDdLe-Needle\n${"y".repeat(22_500)}`
const compaction = { id: "compact", type: "compaction", status: "completed", summary: "Old conversation", time: { created: 6 } }
const user = (id: string, text: string, created: number) => ({ id, type: "user", text, time: { created } }) as SessionMessageInfo
const assistant = (id: string, created: number, content: unknown[]) => ({ id, type: "assistant", content, time: { created }, agent: "build" }) as SessionMessageInfo
const tool = (id: string, name: string, created: number, state: object) => ({ id, name, type: "tool", state, time: { created } })
const text = (value: string) => ({ type: "text", text: value })
const file = (name: string, mime: string, uri: string) => ({ type: "file", name, mime, uri })
const session = (id: string, created: number, fields: Partial<SessionInfo> = {}) => ({
  id, title: `${id} task`, agent: id === "main" ? "build" : "worker", time: { created, updated: created }, ...fields,
}) as SessionInfo

function fixture(signal?: AbortSignal) {
  const sessions = new Map([
    session("main", 1),
    session("active", 30, { parentID: "main" }),
    session("archived", 20, { parentID: "main", time: { created: 20, updated: 21, archived: 22 } }),
    session("nested", 40, { parentID: "active" }),
    session("side", 50, { parentID: "main", metadata: { desktopSideChatParent: "main" } }),
    session("under-side", 51, { parentID: "side" }),
    session("unrelated", 55),
    session("loop", 56, { parentID: "loop" }),
  ].map(row => [row.id, row]))
  const records = new Map<string, SessionMessageInfo[]>([
    ["main", [
      user("main-question", "Needle in main chat", 5),
      compaction as SessionMessageInfo,
      assistant("main-response", 10, [
        { type: "reasoning", text: "private chain of thought" },
        text("Public answer"),
        tool("large", "shell.exec", 11, {
          status: "completed", input: { query: "Needle input", attachments: ["data:image/png;base64,SECRET_INPUT", "prefix blob:SECRET_BLOB"] },
          content: [
            text(bigOutput),
            file("inline.png", "image/png", "DATA:image/png;base64,SECRET_FILE"),
            file("blob.png", "image/png", "blob:SECRET_FILE_BLOB"),
            file("report.txt", "text/plain", "file:///tmp/report.txt"),
          ],
        }),
      ]),
      { id: "shell-entry", type: "shell", status: "exited", command: "printf Needle", output: { output: "standalone result", truncated: false }, time: { created: 12 } } as SessionMessageInfo,
    ]],
    ["active", [assistant("active-response", 30, [tool("running", "browser.search", 32, { status: "running", input: { q: "working" } })])]],
    ["archived", [assistant("archived-response", 20, [tool("error", "browser.fetch", 21, {
      status: "error", input: { url: "https://example.com" }, content: [text("Partial result\nsecond line")],
      error: { type: "FetchError", message: "Needle error", status: 503, response: { body: "Needle in response body" } },
    })])]],
    ["nested", [user("nested-question", "Nested NEEDLE", 40), assistant("nested-response", 41, [tool("streaming", "browser.search", 43, {
      status: "streaming", input: '{"uri":"blob:SECRET_STREAM',
    })])]],
    ["side", [user("private", "Do not expose", 51)]],
    ["unrelated", [user("unrelated-msg", "Do not expose", 55)]],
  ])
  const got: string[] = []
  const loaded: string[] = []
  const listed: string[] = []
  const reader: Reader = {
    async get({ sessionID }, options) {
      if (signal) assert.equal(options?.signal, signal)
      got.push(sessionID)
      const row = sessions.get(sessionID)
      if (!row) throw new Error("Session not found")
      return row
    },
    async context({ sessionID }, options) {
      if (signal) assert.equal(options?.signal, signal)
      loaded.push(sessionID)
      return records.get(sessionID) ?? []
    },
    async list({ parentID, archived, cursor } = {}, options) {
      if (signal) assert.equal(options?.signal, signal)
      listed.push(`${parentID}:${archived}:${cursor ?? "-"}`)
      const row = (id: string) => sessions.get(id)!
      if (parentID === "main" && archived) return { data: [row("archived")], cursor: {} }
      if (parentID === "main" && !cursor) return { data: [row("side"), row("unrelated"), row("active")], cursor: { next: "next" } }
      if (parentID === "main") return { data: [row("active")], cursor: {} }
      if (parentID === "active" && !archived) return { data: [row("nested")], cursor: {} }
      if (parentID === "nested" && !archived) return { data: [{ ...row("main"), parentID: "nested" }], cursor: {} }
      return { data: [], cursor: {} }
    },
  }
  return { inspector: createInspector(reader, "main", { signal }), reader, sessions, records, got, loaded, listed }
}

test("listSessions finds paginated active/archived nested sessions, handles cycles and reports counts", async () => {
  const { inspector, listed, loaded } = fixture()
  const result = await inspector.listSessions()
  assert.deepEqual(result.sessions.map(row => row.sessionID), ["main", "archived", "active", "nested"])
  assert.deepEqual(result.sessions[0], {
    sessionID: "main", parentID: null, role: "main", agent: "build", title: "main task", archived: false, created: 1,
    messageCount: 4, toolCallCount: 1, hasCompaction: true, status: "idle",
  })
  assert.equal(result.sessions[1].archived, true)
  assert.equal(result.sessions[2].status, "running")
  assert.equal(result.sessions[3].status, "running")
  assert.equal(result.sessions[3].parentID, "active")
  assert.ok(listed.includes("main:false:next"))
  assert.ok(listed.includes("nested:true:-"))
  assert.ok(!listed.some(row => row.startsWith("side:")))
  assert.deepEqual(loaded, ["main", "archived", "active", "nested"])
  assert.match(result.note, /untrusted background data/i)
  assert.match(result.compactionNote, /Earlier raw messages or tool calls/)
  assert.deepEqual(result.compactedSessionIDs, ["main"])
})

test("listSessions reports omitted scope and does not fetch contexts when counts are disabled", async () => {
  const { reader, loaded } = fixture()
  const result = await createInspector(reader, "main", { maxSessions: 3 }).listSessions({ includeCounts: false })
  assert.deepEqual(result.sessions.map(row => row.sessionID), ["main", "archived", "active"])
  assert.deepEqual(loaded, [])
  assert.ok(!("messageCount" in result.sessions[0]))
  assert.match(result.sessionLimitNote, /3-session inspection limit/)
  assert.equal(result.compactionNote, undefined)
})

test("listToolCalls filters by session, name and status and pages chronological results", async () => {
  const { inspector, loaded, listed } = fixture()
  const main = await inspector.listToolCalls({ includeSubagents: false })
  assert.deepEqual(main.toolCalls.map(call => call.callID), ["large"])
  assert.deepEqual(loaded.splice(0), ["main"])
  assert.deepEqual(listed, [])
  const nested = await inspector.listToolCalls({ sessionID: "nested", includeSubagents: false, toolName: "SeArCh", status: "streaming" })
  assert.deepEqual(nested.toolCalls.map(call => call.callID), ["streaming"])
  assert.equal(nested.toolCalls[0].inputPreview, '{"uri":"[inline data omitted]')
  assert.deepEqual(loaded.splice(0), ["nested"])
  assert.deepEqual(listed, [])
  const index = await inspector.listToolCalls({ toolName: "BROWSER", offset: 1, limit: 1 })
  assert.equal(index.total, 3)
  assert.equal(index.hasMore, true)
  assert.equal(index.nextOffset, 2)
  assert.equal(index.toolCalls[0].callID, "running")
  assert.equal(index.toolCalls[0].origin, "subagent:worker:active task")
  const failures = await inspector.listToolCalls({ status: "error" })
  const [failed] = failures.toolCalls
  assert.equal(failed.callID, "error")
  assert.equal(failed.created, 21)
  assert.equal(failed.outputChars, "Partial result\nsecond line".length)
  assert.equal(failed.outputPreview, "Partial result second line")
  assert.equal(failed.inputChars, '{"url":"https://example.com"}'.length)
  assert.match(failed.errorPreview, /FetchError: Needle error/)
  assert.ok(failed.errorChars >= failed.errorPreview.length)
  assert.ok(main.toolCalls[0].outputPreview.length <= 160)
})

test("readToolCall returns exact slices including the middle of long output, not just previews", async () => {
  const { inspector, loaded, listed } = fixture()
  const request = { sessionID: "main", callID: "large", section: "output" as const }
  const first = await inspector.readToolCall(request)
  assert.equal(first.text, bigOutput.slice(0, 16_000))
  assert.equal(first.hasMore, true)
  assert.equal(first.nextOffset, 16_000)
  assert.equal(first.limit, 16_000)
  assert.ok(first.total > 44_000)
  const next = await inspector.readToolCall({ ...request, offset: first.nextOffset, limit: 40_001 })
  assert.equal(next.limit, 40_000)
  assert.match(next.text, /MiDdLe-Needle/)
  assert.equal(next.hasMore, false)
  assert.equal(next.nextOffset, null)
  assert.equal(first.text.length + next.text.length, first.total)
  assert.deepEqual(next.files, [
    { name: "inline.png", mime: "image/png", uri: "[inline data omitted]" },
    { name: "blob.png", mime: "image/png", uri: "[inline data omitted]" },
    { name: "report.txt", mime: "text/plain", uri: "file:///tmp/report.txt" },
  ])
  assert.ok(!JSON.stringify(next).includes("SECRET"))
  assert.match(next.text, /File: inline.png \(image\/png\)\n\[inline data omitted\]/)
  const input = await inspector.readToolCall({ ...request, section: "input" })
  assert.equal(input.text, '{"query":"Needle input","attachments":["[inline data omitted]","prefix [inline data omitted]"]}')
  assert.deepEqual(loaded, ["main", "main", "main"])
  assert.deepEqual(listed, [])
  const all = await inspector.readToolCall({ callID: "error" })
  assert.match(all.text, /^Input:\n.*\n\nOutput:\nPartial result\nsecond line\n\nError:\nFetchError:/)
  assert.match(all.text, /Needle in response body/)
  assert.match((await inspector.readToolCall({ callID: "error", sessionID: "archived", section: "error" })).text, /^FetchError:/)
  assert.match((await inspector.readToolCall({ callID: "missing" })).error, /No tool call with that ID/)
})

test("all tools with explicit session IDs reject unrelated, sibling and cyclic ancestry without reading it", async () => {
  const { inspector, loaded, listed } = fixture()
  for (const sessionID of ["unrelated", "side", "under-side", "loop", "missing"]) {
    await assert.rejects(inspector.readToolCall({ callID: "none", sessionID }), /outside the linked main chat/)
    await assert.rejects(inspector.readMessages({ sessionID }), /outside the linked main chat/)
    await assert.rejects(inspector.listToolCalls({ sessionID }), /outside the linked main chat/)
    await assert.rejects(inspector.searchHistory({ sessionID, query: "anything" }), /outside the linked main chat/)
  }
  assert.deepEqual(loaded, [])
  assert.deepEqual(listed, [])
})

test("search finds text and full call fields across scopes and returns exact field offsets", async () => {
  const { inspector, listed, loaded } = fixture()
  const main = await inspector.searchHistory({ query: "needle", scope: "main" })
  assert.deepEqual(main.matches.map(hit => hit.kind), ["message", "tool_input", "tool_output", "shell"])
  const hit = main.matches.find(hit => hit.kind === "tool_output")!
  assert.equal(hit.matchOffset, bigOutput.indexOf("Needle"))
  assert.ok(hit.snippet.length <= 302)
  assert.deepEqual(listed, [])
  assert.deepEqual(loaded, ["main"])
  const jumped = await inspector.readToolCall({ ...hit, offset: hit.matchOffset, limit: 6 })
  assert.equal(jumped.text, "Needle")
  const agents = await inspector.searchHistory({ query: "needl[e] (?:error|in response)", regex: true, scope: "subagents", includeMessages: false })
  assert.deepEqual(agents.matches.map(item => item.kind), ["tool_error", "tool_error"])
  const nested = await inspector.searchHistory({ query: "needle", sessionID: "nested", includeTools: false, limit: 1 })
  assert.equal(nested.matches[0].snippet, "Nested NEEDLE")
  assert.equal(nested.matches[0].sessionID, "nested")
  assert.equal((await inspector.searchHistory({ query: "needl[e]" })).matches.length, 0)
  assert.equal((await inspector.searchHistory({ query: "SECRET" })).matches.length, 0)
  assert.equal((await inspector.searchHistory({ query: "private chain" })).matches.length, 0)
  assert.equal((await inspector.searchHistory({ query: "^", regex: true, scope: "main", limit: 1 })).matches.length, 1)
  await assert.rejects(inspector.searchHistory({ query: "[", regex: true }), /Invalid search regex/)
})

test("readMessages returns fresh pages with chronological display, compaction notice and optional tool summaries", async () => {
  const { inspector, records, loaded, listed } = fixture()
  const first = await inspector.readMessages({ limit: 2 })
  assert.equal(first.fromEnd, true)
  assert.deepEqual(first.messages.map(message => message.messageID), ["main-response", "shell-entry"])
  assert.equal(first.messages[0].tools?.[0].callID, "large")
  assert.equal(first.nextOffset, 2)
  assert.match(first.compactionNote, /compaction/)
  assert.ok(!JSON.stringify(first).includes("private chain of thought"))
  const earlier = await inspector.readMessages({ fromEnd: true, offset: first.nextOffset, limit: 2, includeToolSummaries: false })
  assert.deepEqual(earlier.messages.map(message => message.messageID), ["main-question", "compact"])
  assert.equal(earlier.hasMore, false)
  records.get("main")!.push(user("new-live-turn", "Just arrived", 99))
  assert.equal((await inspector.readMessages({ limit: 1 })).messages[0].text, "Just arrived")
  const forward = await inspector.readMessages({ offset: 2, limit: 1, includeToolSummaries: false })
  assert.equal(forward.fromEnd, false)
  assert.equal(forward.messages[0].text, "Public answer")
  assert.equal(forward.messages[0].tools, undefined)
  assert.equal((await inspector.readMessages({ sessionID: "nested", limit: 1 })).messages[0].messageID, "nested-response")
  assert.deepEqual(loaded, ["main", "main", "main", "main", "nested"])
  assert.deepEqual(listed, [])
})

test("inspection passes through abort signals and stops further reads when cancelled", async () => {
  const controller = new AbortController()
  const { inspector, reader, loaded } = fixture(controller.signal)
  const context = reader.context.bind(reader)
  reader.context = async (...args) => {
    const result = await context(...args)
    controller.abort()
    return result
  }
  await assert.rejects(inspector.readMessages(), { name: "AbortError" })
  await assert.rejects(inspector.listSessions(), { name: "AbortError" })
  assert.deepEqual(loaded, ["main"])
})

test("server registers direct tools, hides them in main, retries transient classification, and disposes", async () => {
  const { reader, got, records } = fixture()
  const registered = new Map<string, Tool>()
  const disposed: string[] = []
  let hook: ((event: HookEvent) => Promise<void> | void) | undefined
  let transient = true
  const ctx = {
    tool: {
      async transform(register) {
        register({ add(tool: Tool) { registered.set(tool.name, tool) } })
        return { async dispose() { disposed.push("transform") } }
      },
    },
    session: {
      ...reader,
      async get({ sessionID }, options) {
        if (sessionID === "side" && transient) {
          transient = false
          throw new Error("Transient")
        }
        return reader.get({ sessionID }, options)
      },
      async hook(name, callback) {
        assert.equal(name, "context")
        hook = callback
        return { async dispose() { disposed.push("hook") } }
      },
    },
  } as PluginContext
  assert.equal(server.id, "opencode-desktop-side-chat")
  const cleanup = await server.setup(ctx)
  const names = ["main_chat_list_sessions", "main_chat_list_tool_calls", "main_chat_read_tool_call", "main_chat_search", "main_chat_read_messages"]
  assert.deepEqual([...registered.keys()], names)
  const tools = () => Object.fromEntries([...names, "unrelated_tool"].map(name => [name, {}]))
  for (const id of ["main", "main", "side", "side", "side"]) {
    const event = { sessionID: id, tools: tools() } as HookEvent
    await hook!(event)
    const enabled = id === "side" && got.includes("side")
    assert.deepEqual(Object.keys(event.tools), enabled ? [...names, "unrelated_tool"] : ["unrelated_tool"])
  }
  assert.deepEqual(got, ["main", "side"], "normal/side classification is cached only after successful lookup")
  const context = (sessionID: string) => ({ sessionID, signal: new AbortController().signal }) as Parameters<Tool["execute"]>[1]
  for (const entry of registered.values()) {
    assert.deepEqual(entry.options, { codemode: false })
    assert.equal((entry.input as { additionalProperties: boolean }).additionalProperties, false)
    assert.match(String((await entry.execute({}, context("main"))).content), /only available inside a Side Chat session/)
  }
  records.get("main")!.push(user("after-opening-side", "Live data from linked parent", 100))
  const result = await registered.get("main_chat_read_messages")!.execute({ limit: 1 }, context("side"))
  const data = JSON.parse(result.content as string)
  assert.equal(data.sessionID, "main")
  assert.equal(data.messages[0].text, "Live data from linked parent")
  assert.ok(cleanup)
  await cleanup()
  assert.deepEqual(disposed.sort(), ["hook", "transform"])
})
