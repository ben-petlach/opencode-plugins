import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import type { SessionContext as HookEvent } from "@opencode/plugin/promise/session"
import server from "../src/server.ts"

type PluginContext = Parameters<typeof server.setup>[0]
type ToolEditor = Parameters<Parameters<PluginContext["tool"]["transform"]>[0]>[0]
type Tool = Parameters<ToolEditor["add"]>[0]

const name = "read_mentioned_chat"
const id = (n: number) => `ses_${n.toString().padStart(26, "A")}`
const mention = (n: number) => `@session:${id(n)}`
const user = (text: string, i = 0) => ({ id: `msg_${i}`, type: "user", text, time: { created: i } }) as const

async function fixture() {
  const sessions = new Map(Array.from({ length: 7 }, (_, i) => [id(i), {
    id: id(i), title: `Chat title ${i}`, location: { directory: "/example" }, time: { created: i, updated: i },
  } as SessionInfo]))
  const records = new Map<string, SessionMessageInfo[]>([...sessions.keys()].map(key => [key, []]))
  let tool: Tool | undefined
  let hook: ((event: HookEvent) => void | Promise<void>) | undefined
  const disposed: string[] = []
  const got: string[] = []
  const loaded: string[] = []
  const toolDomain: Pick<PluginContext["tool"], "transform"> = {
    async transform(install) {
      const editor: Pick<ToolEditor, "add"> = { add: spec => { assert.equal(tool, undefined); tool = spec as Tool } }
      install(editor as ToolEditor)
      return { async dispose() { disposed.push("tool") } }
    },
  }
  const sessionDomain: Pick<PluginContext["session"], "get" | "context" | "hook"> = {
    async get({ sessionID }) {
      got.push(sessionID)
      const session = sessions.get(sessionID)
      if (!session) throw new Error("missing session")
      return session
    },
    async context({ sessionID }) {
      loaded.push(sessionID)
      const messages = records.get(sessionID)
      if (!messages) throw new Error("missing context")
      return messages
    },
    async hook(key, callback) {
      assert.equal(key, "context")
      hook = callback as typeof hook
      return { async dispose() { disposed.push("context") } }
    },
  }
  const cleanup = await server.setup({ tool: toolDomain, session: sessionDomain } as PluginContext)
  assert.equal(tool!.name, name)
  assert.equal(tool!.options?.codemode, false)
  return {
    sessions, records, loaded, got, disposed,
    async runContext(text = "", sessionID = id(0)) {
      const others = { description: "Unrelated tool", input: {} }
      const event: HookEvent = {
        sessionID: sessionID as HookEvent["sessionID"],
        agent: "build" as HookEvent["agent"],
        model: { providerID: "test", id: "model" } as HookEvent["model"],
        options: {},
        system: [{ type: "text", text: "Original system" }],
        tools: { [name]: { description: tool!.description, input: { type: "object" } }, other: others },
        messages: [
          { role: "user", content: [{ type: "text", text }] },
          { role: "assistant", content: [{ type: "text", text: mention(5) }] },
        ],
      }
      await hook!(event)
      return event
    },
    async read(args: object, sessionID = id(0)) {
      const context = { sessionID, signal: new AbortController().signal } as Parameters<Tool["execute"]>[1]
      const result = await tool!.execute(args, context)
      assert.equal(typeof result.content, "string")
      return JSON.parse(result.content as string)
    },
    async dispose() { if (typeof cleanup === "function") await cleanup() },
  }
}

test("no explicit user mentions leaves system and unrelated tools untouched with no session reads", async () => {
  const f = await fixture()
  const event = await f.runContext(`${id(1)} ${mention(0)}`)
  assert.deepEqual(Object.keys(event.tools), ["other"])
  assert.deepEqual(event.system, [{ type: "text", text: "Original system" }])
  assert.deepEqual(f.got, [])
  assert.deepEqual(f.loaded, [])
  assert.match((await f.read({ sessionID: id(5) })).error, /not explicitly @-mentioned/)
  assert.deepEqual(f.loaded, [])
  await f.dispose()
  assert.deepEqual(f.disposed.sort(), ["context", "tool"])
})

test("explicit mentions keep the tool available and reuse transcripts until the session timestamp changes", async () => {
  const f = await fixture()
  f.records.set(id(1), [user(`Older context with nested ${mention(3)}`)])
  const first = await f.runContext(`Consider ${mention(1)}`)
  assert.ok(name in first.tools)
  assert.equal(first.system.length, 2)
  assert.match(first.system[1].text, /^<mentioned-chats>[\s\S]*Chat title 1[\s\S]*Older context/)
  assert.doesNotMatch(first.system[1].text, /Chat title 3/)
  assert.deepEqual(f.got, [id(1)])
  assert.deepEqual(f.loaded, [id(1)])
  f.records.set(id(1), [user("New context")])
  const second = await f.runContext(mention(1))
  assert.equal(second.system[1].text, first.system[1].text)
  assert.deepEqual(f.got, [id(1), id(1)])
  assert.deepEqual(f.loaded, [id(1)])
  f.sessions.get(id(1))!.time.updated += 1
  const updated = await f.runContext(mention(1))
  assert.match(updated.system[1].text, /New context/)
  assert.deepEqual(f.loaded, [id(1), id(1)])
})

test("one missing or inaccessible mentioned session does not prevent other transcripts from loading", async () => {
  const f = await fixture()
  f.sessions.delete(id(2))
  f.records.delete(id(3))
  f.records.set(id(1), [user("Still available")])
  const { system } = await f.runContext(`${mention(2)} ${mention(1)} ${mention(3)}`)
  assert.match(system[1].text, new RegExp(`\\[Could not load mentioned chat ${id(2)}\\][\\s\\S]*Still available[\\s\\S]*\\[Could not load mentioned chat ${id(3)}\\]`))
  assert.match((await f.read({ sessionID: id(2) })).error, /Could not load mentioned chat/)
})

test("injects only first five mentions; overflow is authorized, nested and cross-chat mentions are not", async () => {
  const f = await fixture()
  f.records.set(id(1), [user(mention(7))])
  const event = await f.runContext([1, 2, 3, 4, 5, 1, 6].map(mention).join(" "))
  assert.deepEqual(f.loaded, [1, 2, 3, 4, 5].map(id))
  assert.match(event.system[1].text, new RegExp(`Additional mentioned chats .*${id(6)}`))
  assert.doesNotMatch(event.system[1].text, /Chat title 6/)
  assert.equal((await f.read({ sessionID: id(6) })).sessionID, id(6))
  assert.match((await f.read({ sessionID: id(7) })).error, /not explicitly @-mentioned/)
  assert.ok(!f.got.includes(id(7)))
  await f.runContext("", id(2))
  assert.match((await f.read({ sessionID: id(1) }, id(2))).error, /not explicitly @-mentioned/)
})

test("pages in both directions and searches case-insensitively using chronological offsets", async () => {
  const f = await fixture()
  f.records.set(id(1), [
    user("First needle", 0), user("Second", 1), user("Third NEEDLE", 2), user("Fourth", 3), user("Fifth Needle", 4),
  ])
  await f.runContext(mention(1))
  const read = (options: object) => f.read({ sessionID: id(1), ...options })
  const newest = await read({ limit: 2 })
  assert.equal(newest.fromEnd, true)
  assert.equal(newest.totalTurns, 5)
  assert.deepEqual(newest.turns.map((t: { index: number }) => t.index), [3, 4])
  const older = await read({ limit: newest.nextLimit, offset: newest.nextOffset, fromEnd: true })
  assert.deepEqual(older.turns.map((t: { index: number }) => t.index), [1, 2])
  const oldest = await read({ limit: older.nextLimit, offset: older.nextOffset, fromEnd: true })
  assert.deepEqual(oldest.turns.map((t: { index: number }) => t.index), [0])
  assert.equal(oldest.nextOffset, null)
  const forward = await read({ offset: 1, limit: 2 })
  assert.equal(forward.fromEnd, false)
  assert.deepEqual(forward.turns.map((t: { index: number }) => t.index), [1, 2])
  assert.equal(forward.nextOffset, 3)
  const found = await read({ query: "nEeDlE", limit: 2 })
  assert.equal(found.fromEnd, false)
  assert.equal(found.matchedTurns, 3)
  assert.deepEqual(found.turns.map((t: { index: number }) => t.index), [0, 2])
  assert.equal(found.nextOffset, 4)
  assert.deepEqual((await read({ query: "needle", offset: found.nextOffset })).turns, [{ index: 4, text: "User: Fifth Needle" }])
  assert.deepEqual((await read({ query: "missing" })).turns, [])
  assert.deepEqual(f.loaded, [id(1)])
})

test("cache-miss authorization checks stored user messages only, fails closed and never loads an unmentioned target", async () => {
  const f = await fixture()
  f.records.set(id(0), [
    user(`${mention(1)} ${id(3)} ${mention(0)}`),
    { type: "synthetic", id: "notice", time: { created: 1 }, text: mention(2) },
  ])
  assert.match((await f.read({ sessionID: id(2) })).error, /not explicitly @-mentioned/)
  assert.match((await f.read({ sessionID: id(3) })).error, /not explicitly @-mentioned/)
  assert.match((await f.read({ sessionID: id(0) })).error, /not explicitly @-mentioned/)
  assert.deepEqual(f.loaded, [id(0)])
  assert.deepEqual(f.got, [])
  assert.equal((await f.read({ sessionID: id(1) })).sessionID, id(1))
  assert.deepEqual(f.loaded, [id(0), id(1)])
  assert.match((await f.read({ sessionID: id(1) }, id(9))).error, /Could not verify/)
  await f.runContext("No longer in the model request")
  assert.match((await f.read({ sessionID: id(1) })).error, /not explicitly @-mentioned/)
  assert.deepEqual(f.got, [id(1)])
})
