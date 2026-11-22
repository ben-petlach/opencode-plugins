import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import * as sdk from "@opencode/plugin/gui"
import * as solid from "solid-js"
import * as effect from "effect"
import { createRoot, createSignal } from "solid-js"
const modules: Record<string, unknown> = { "@opencode/plugin/gui": sdk, "solid-js": solid, effect }
const flush = () => new Promise((resolve) => setTimeout(resolve, 10))

test("built GUI caches both controls, filters drafts, dismisses per turn, and isolates sessions", async () => {
  const registry = new Map<string, any[]>()
  const handlers = new Map<string, (event: any) => void>()
  const [text, setText] = createSignal("")
  const [status, setStatus] = createSignal("idle")
  const [loaded, setLoaded] = createSignal(false)
  let calls = 0
  let messageID = "assistant-1"
  let focused = false
  let stale: ((result: { text: string }) => void) | undefined
  let next = '{"follow_ups":["Can we use staging?","Can you check the logs?","Could you show the trace?"],"primary":1}'
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} }
  const data = {
    on: (name: string, callback: any) => { handlers.set(name, callback); return () => handlers.delete(name) },
    session: {
      get: () => ({ parentID: undefined }), status, pending: { list: () => loaded() ? [] : undefined },
      permission: { list: () => loaded() ? [] : undefined }, form: { list: () => [] },
      message: { list: () => loaded() ? [{ type: "user", text: "Explain tests" }, { id: messageID, type: "assistant", content: [{ type: "text", text: "Done" }] }] : undefined },
    },
  }
  const session = { id: "test", key: "local/test", visit: {}, server: {
    connected: true, data, client: { experimental: { generate: { text: async (input: { model: unknown }) => {
      assert.deepEqual(JSON.parse(JSON.stringify(input.model)), { providerID: "google-vertex", id: "gemini-3.1-flash-lite", variant: "minimal" })
      calls++
      if (next === "pending") return new Promise<{ text: string }>((resolve) => { stale = resolve })
      return { text: next }
    } } } },
  } }
  const [current, setCurrent] = createSignal<any>(session)
  const composer = { text, quotable: () => true, insert: setText, focus: () => { focused = true }, focused: () => focused }
  const screen = { composer }
  const exports: any = {}
  vm.runInNewContext(readFileSync(new URL("../dist/gui-experimental.cjs", import.meta.url), "utf8"), {
    exports, require: (id: string) => modules[id], document, window: document, console,
    AbortController, setTimeout, clearTimeout, queueMicrotask,
  })
  let dispose!: () => void
  createRoot((cleanup) => {
    dispose = cleanup
    exports.default.setup({
      signal: new AbortController().signal,
      id: "followups", keybinds: { keybind: () => ["Tab"] },
      stores: { prefs: { value: { enabled: true }, update() {} } },
      sessions: { current }, screen: { current: () => screen },
      add: (token: { id: string }, value: any) => registry.set(token.id, [...registry.get(token.id) ?? [], value]),
    })
  })
  const show = (id: string) => registry.get("composer-pill")?.find((pill) => pill.id === id).show({ session: current(), screen })
  const command = (id: string) => registry.get("command")?.map((factory) => factory()).find((item) => item.id === id)
  const complete = (id: string, sessionID = "test") => handlers.get("session.execution.succeeded")?.({ id, data: { sessionID } })
  const start = () => handlers.get("session.execution.started")?.({ data: { sessionID: current().id } })
  try {
    await flush()
    assert.equal(registry.get("composer-pill")?.length, 2)
    assert(command("suggest"), "Commands survive startup before session data loads")
    setLoaded(true)
    setStatus("running")
    complete("1")
    await flush()
    assert.equal(calls, 0)
    setText("can YOU")
    setStatus("idle")
    await flush()
    assert.equal(calls, 1, "Typing never blocks generation")
    const primary = () => show("primary-suggestion")
    const menu = () => show("suggestions")
    assert.equal(primary().label, "Can you check the logs?")
    assert.equal(menu().label, "Suggested next prompts")
    assert.equal(menu().rows.length, 2, "Incompatible choices are filtered, leaving the match and dismissal")
    assert.equal(primary().run, undefined)
    assert.equal(menu().rows[0].run, undefined)
    assert.equal(command("accept").run(), false)
    assert.equal(text(), "can YOU")
    setText("can they")
    assert.equal(menu(), undefined)
    assert.equal(primary(), undefined)
    setText("CAN Y")
    assert.equal(primary().label, "Can you check the logs?")
    assert.equal(calls, 1, "Erasing back to a match reuses the prediction")
    setText("")
    assert.equal(menu().rows[0].label, primary().label)
    assert.match(primary().title, /Tab in the prompt/)
    assert.equal(command("accept").run(), false, "Do not take Tab outside the composer")
    primary().run()
    assert.equal(text(), "Can you check the logs?")
    assert(focused)
    assert.equal(primary(), undefined)
    setText("")
    assert.equal(command("accept").run(), undefined)
    assert.equal(text(), "Can you check the logs?")
    setText("")
    menu().rows.at(-1).run()
    complete("1")
    assert.equal(menu(), undefined)
    assert.equal(calls, 1, "Dismissal lasts even if the same completion is replayed")
    const otherSession = { ...session, key: "local/other", id: "other", visit: {} }
    setCurrent(otherSession)
    await flush()
    assert.equal(menu(), undefined)
    setCurrent({ ...session, visit: {} })
    await flush()
    assert.equal(menu(), undefined, "Dismissal survives leaving the session")
    next = '{"follow_ups":["Use staging","Run locally"],"primary":null}'
    command("suggest").run()
    await flush()
    assert.equal(calls, 2)
    assert.equal(primary(), undefined)
    assert.equal(menu().rows[0].label, "Use staging")
    menu().rows[1].run()
    assert.equal(text(), "Run locally")
    setText("")
    start()
    assert.equal(menu(), undefined)
    next = "pending"
    complete("2")
    await flush()
    assert.equal(calls, 3)
    setCurrent(otherSession)
    await flush()
    stale?.({ text: '{"follow_ups":["stale"],"primary":0}' })
    await flush()
    assert.equal(menu(), undefined, "An old visit cannot publish in the new session")
    setCurrent({ ...session, visit: {} })
    await flush()
    assert.equal(menu(), undefined, "The discarded response is not cached")
    next = '{"follow_ups":["Latest"],"primary":0}'
    command("suggest").run()
    await flush()
    setCurrent(otherSession)
    await flush()
    messageID = "assistant-2"
    setCurrent({ ...session, visit: {} })
    await flush()
    assert.equal(menu(), undefined, "A turn completed elsewhere invalidates the cached result")
  } finally {
    dispose()
  }
  assert.equal(handlers.size, 0)
})
