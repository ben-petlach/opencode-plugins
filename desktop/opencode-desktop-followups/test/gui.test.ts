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
  const [text, setText] = createSignal("")
  const [status, setStatus] = createSignal("idle")
  const [loaded, setLoaded] = createSignal(false)
  let calls = 0
  const turn = (id: string, outcome = "succeeded") => [
    { id: `user-${id}`, type: "user", text: "Explain tests" },
    { id: `assistant-${id}`, type: "assistant", content: [{ type: "text", text: "Done" }] },
    { id: `idle-${id}`, type: "idle", outcome },
  ]
  const [history, setHistory] = createSignal(turn("1"))
  const [dismissal, setDismissal] = createSignal<{ turnID: string | null }>()
  const dismissalStore = {
    get value() { return dismissal() },
    update(change: (value: { turnID: string | null }) => void) {
      const value = { turnID: null, ...dismissal() }
      change(value)
      setDismissal(value)
    },
  }
  let focused = false
  let stale: ((result: { text: string }) => void) | undefined
  const primaryText = "Can you check the logs from the last deployment and identify which request is causing the timeouts?"
  let next = JSON.stringify({ follow_ups: ["Can we use staging?", primaryText, "Could you show the trace?"], primary: 1 })
  let syncTooltip: (() => void) | undefined
  let accessibleName = ""
  let shownTooltip: { textContent: string } | undefined
  const tooltipText = () => shownTooltip?.textContent
  const listeners = new Map<string, () => void>()
  const primaryButton = {
    textContent: primaryText,
    getAttribute: (name: string) => name === "aria-label" ? accessibleName : null,
    getBoundingClientRect: () => ({ left: 680, top: 350, bottom: 380 }),
    matches: () => false,
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  }
  const menuButton = { ...primaryButton, textContent: "Suggested next prompts", addEventListener: () => assert.fail("Menu gains no tooltip") }
  const document = {
    body: { append: (element: { textContent: string }) => { shownTooltip = element } },
    visibilityState: "visible", addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [menuButton, primaryButton],
    createElement: () => ({
      textContent: "", dataset: {}, style: {}, setAttribute() {},
      getBoundingClientRect: () => ({ width: 360, height: 42 }),
      remove() { shownTooltip = undefined },
    }),
  }
  const window = { innerWidth: 800, addEventListener() {}, removeEventListener() {} }
  class MutationObserver {
    constructor(private callback: () => void) {}
    observe() { syncTooltip = this.callback }
    disconnect() { syncTooltip = undefined }
  }
  const data = {
    session: {
      get: () => ({ parentID: undefined }), status, pending: { list: () => loaded() ? [] : undefined },
      permission: { list: () => loaded() ? [] : undefined }, form: { list: () => [] },
      message: { list: (id: string) => id === "other" ? [] : loaded() ? history() : undefined },
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
    exports, require: (id: string) => modules[id], document, window, console,
    AbortController, MutationObserver, setTimeout, clearTimeout, queueMicrotask,
  })
  let dispose!: () => void
  createRoot((cleanup) => {
    dispose = cleanup
    exports.default.setup({
      signal: new AbortController().signal,
      id: "followups", keybinds: { keybind: () => ["Tab"] },
      stores: { prefs: { value: { enabled: true }, update() {} }, dismissal: () => dismissalStore },
      sessions: { current }, screen: { current: () => screen },
      add: (token: { id: string }, value: any) => registry.set(token.id, [...registry.get(token.id) ?? [], value]),
    })
  })
  const show = (id: string) => registry.get("composer-pill")?.find((pill) => pill.id === id).show({ session: current(), screen })
  const command = (id: string) => registry.get("command")?.map((factory) => factory()).find((item) => item.id === id)
  try {
    await flush()
    assert.equal(registry.get("composer-pill")?.length, 2)
    assert(command("suggest"), "Commands survive startup before session data loads")
    setStatus("running")
    setLoaded(true)
    await flush()
    assert.equal(calls, 0)
    setText("can YOU")
    setStatus("idle")
    await flush()
    assert.equal(calls, 0, "Wait for persisted dismissal to load")
    setDismissal({ turnID: null })
    await flush()
    assert.equal(calls, 1, "Typing never blocks generation")
    const primary = () => show("primary-suggestion")
    const menu = () => show("suggestions")
    assert.equal(primary().label, primaryText)
    assert.equal(menu().label, "Suggested next prompts")
    accessibleName = primary().title
    syncTooltip?.()
    assert.equal(shownTooltip, undefined)
    listeners.get("pointerenter")?.()
    assert.equal(tooltipText(), primaryText, "The button itself reveals the full prompt")
    listeners.get("pointerleave")?.()
    assert.equal(shownTooltip, undefined)
    listeners.get("pointerenter")?.()
    assert.equal(menu().rows.length, 2, "Incompatible choices are filtered, leaving the match and dismissal")
    assert.equal(primary().run, undefined)
    assert.equal(menu().rows[0].run, undefined)
    assert.equal(command("accept").run(), false)
    assert.equal(text(), "can YOU")
    setText("can they")
    assert.equal(menu(), undefined)
    assert.equal(primary(), undefined)
    await flush()
    assert.equal(shownTooltip, undefined, "Hidden suggestions remove the tooltip")
    assert.equal(listeners.size, 0, "Removed pills lose their hover listeners")
    assert.equal(syncTooltip, undefined, "Hidden suggestions stop observing the host")
    setText("CAN Y")
    assert.equal(primary().label, primaryText)
    assert.equal(calls, 1, "Erasing back to a match reuses the prediction")
    setText("")
    assert.equal(menu().rows[0].label, primary().label)
    assert.match(primary().title, /Tab in the prompt/)
    assert.equal(command("accept").run(), false, "Do not take Tab outside the composer")
    primary().run()
    assert.equal(text(), primaryText)
    assert(focused)
    assert.equal(primary(), undefined)
    setText("")
    assert.equal(command("accept").run(), undefined)
    assert.equal(text(), primaryText)
    setText("")
    menu().rows.at(-1).run()
    assert.equal(dismissal()?.turnID, "idle-1")
    setHistory(turn("1"))
    assert.equal(menu(), undefined)
    assert.equal(calls, 1, "Dismissal lasts even when the same turn reloads")
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
    assert.equal(dismissal()?.turnID, null, "Manual regeneration clears the stored dismissal")
    assert.equal(primary(), undefined)
    assert.equal(menu().rows[0].label, "Use staging")
    menu().rows[1].run()
    assert.equal(text(), "Run locally")
    setText("")
    setStatus("running")
    assert.equal(menu(), undefined)
    next = "pending"
    setHistory(turn("2"))
    setStatus("idle")
    await flush()
    assert.equal(calls, 3)
    setCurrent(otherSession)
    await flush()
    stale?.({ text: '{"follow_ups":["stale"],"primary":0}' })
    await flush()
    assert.equal(menu(), undefined, "An old visit cannot publish in the new session")
    next = '{"follow_ups":["Recovered"],"primary":0}'
    setCurrent({ ...session, visit: {} })
    await flush()
    assert.equal(calls, 4)
    assert.equal(menu().rows[0].label, "Recovered", "Returning retries the cancelled generation")
    setCurrent(otherSession)
    await flush()
    setCurrent({ ...session, visit: {} })
    await flush()
    assert.equal(calls, 4, "Reopening a cached result makes no request")

    setCurrent(otherSession)
    await flush()
    setHistory(turn("3"))
    next = '{"follow_ups":["Completed elsewhere"],"primary":null}'
    setLoaded(false)
    setCurrent({ ...session, visit: {} })
    await flush()
    assert.equal(calls, 4, "Wait for the stored reply to load")
    setLoaded(true)
    await flush()
    assert.equal(calls, 5)
    assert.equal(menu().rows[0].label, "Completed elsewhere")
    assert.equal(primary(), undefined)

    setHistory(turn("4", "failed"))
    await flush()
    assert.equal(calls, 5, "Failed turns have no automatic prediction")
    assert.equal(menu(), undefined)
    next = '{"follow_ups":[],"primary":null}'
    setHistory(turn("5"))
    await flush()
    assert.equal(calls, 6)
    setCurrent({ ...otherSession, visit: {} })
    await flush()
    setCurrent({ ...session, visit: {} })
    await flush()
    assert.equal(calls, 6, "A completed empty result is cached")
    assert.equal(menu(), undefined)
  } finally {
    dispose()
  }
})
