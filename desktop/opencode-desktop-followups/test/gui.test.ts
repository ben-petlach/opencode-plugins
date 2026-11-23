import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import * as sdk from "@opencode/plugin/gui"
import * as solid from "solid-js"
import * as effect from "effect"
import { createEffect, createRoot, createSignal } from "solid-js"
import type { FollowupsRequest, FollowupsService } from "../src/service"

const modules: Record<string, unknown> = { "@opencode/plugin/gui": sdk, "solid-js": solid, effect }
const flush = () => new Promise((resolve) => setTimeout(resolve, 10))
const pluginID = "opencode-desktop-followups"

function loadGui(document: object, globals = {}) {
  const exports: any = {}
  vm.runInNewContext(readFileSync(new URL("../dist/gui-experimental.cjs", import.meta.url), "utf8"), {
    exports, require: (id: string) => modules[id], document, console,
    AbortController, setTimeout, clearTimeout, queueMicrotask, ...globals,
  })
  return exports.default
}

test("built GUI caches both controls, filters drafts, dismisses per turn, and isolates sessions", async () => {
  const registry = new Map<string, any[]>()
  const provided = new Map<string, FollowupsService>()
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
  const plugin = loadGui(document, { window, MutationObserver })
  let dispose!: () => void
  createRoot((cleanup) => {
    dispose = cleanup
    plugin.setup({
      signal: new AbortController().signal,
      id: pluginID, keybinds: { keybind: () => ["Tab"] },
      stores: { prefs: { value: { enabled: true }, update() {} }, dismissal: () => dismissalStore },
      sessions: { current }, screen: { current: () => screen },
      add: (token: { id: string }, value: any) => registry.set(token.id, [...registry.get(token.id) ?? [], value]),
      provide: (token: sdk.Contract<FollowupsService>, value: FollowupsService) => provided.set(token.id, value),
    })
  })
  const show = (id: string) => registry.get("composer-pill")?.find((pill) => pill.id === id).show({ session: current(), screen })
  const command = (id: string) => registry.get("command")?.map((factory) => factory()).find((item) => item.id === id)
  try {
    await flush()
    assert.equal(registry.get("composer-pill")?.length, 2)
    assert(provided.has(`${pluginID}.suggestions`))
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

test("built GUI provides reactive predictions and isolates, deduplicates, and cancels scoped requests", async () => {
  const plugin = loadGui({ visibilityState: "visible", addEventListener() {}, removeEventListener() {} })
  const [enabled, setEnabled] = createSignal(true)
  const [keybind, setKeybind] = createSignal(["Tab"])
  const [watchTurn, setWatchTurn] = createSignal("idle-1")
  const calls: {
    prompt: string
    model: Parameters<FollowupsRequest["generate"]>[1]
    signal: AbortSignal
    resolve: (choice: string) => void
  }[] = []
  const input: FollowupsRequest = {
    scopeKey: "side-chat/local/session",
    turnID: "idle-1",
    messages: [
      { id: "user-1", type: "user", time: { created: 0 }, text: "can you explain this test" },
      {
        id: "assistant-1", type: "assistant", time: { created: 1 }, agent: "build",
        model: { providerID: "test", id: "test" },
        content: [{ type: "text", text: "It checks request cancellation." }],
      },
    ],
    generate: (prompt, model, signal) => new Promise((resolve) => {
      calls.push({ prompt, model, signal, resolve: (choice) => resolve({
        text: JSON.stringify({ follow_ups: [choice], primary: 0 }),
      }) })
    }),
  }
  let service!: FollowupsService
  let observedEnabled: boolean | undefined
  let observedKeybind: readonly string[] | undefined
  let observedPrediction: ReturnType<FollowupsService["get"]>
  const prediction = () => observedPrediction
  let dispose!: () => void
  createRoot((cleanup) => {
    dispose = cleanup
    plugin.setup({
      signal: new AbortController().signal,
      id: pluginID,
      keybinds: { keybind(id: string) { assert.equal(id, `${pluginID}.accept`); return keybind() } },
      stores: { prefs: { get value() { return { enabled: enabled() } } } },
      sessions: { current: () => undefined }, screen: { current: () => undefined },
      add() {},
      provide(token: sdk.Contract<FollowupsService>, value: FollowupsService) {
        assert.deepEqual(token, { kind: "contract", id: "opencode-desktop-followups.suggestions" })
        service = value
      },
    })
    createEffect(() => {
      observedEnabled = service.enabled()
      observedKeybind = service.acceptKeybind()
      observedPrediction = service.get(input.scopeKey, watchTurn())
    })
  })

  try {
    assert.equal(observedEnabled, true)
    assert.deepEqual(observedKeybind, ["Tab"])
    setKeybind(["Shift", "Tab"])
    assert.deepEqual(observedKeybind, ["Shift", "Tab"])
    assert(service.matchesDraft("Can you check?", "CAN YOU"))
    assert(!service.matchesDraft("Can you check?", "can we"))
    assert.equal(prediction(), undefined)
    service.request({ ...input, eligible: () => false })
    assert.equal(calls.length, 0, "Ineligible callers never reach the provider")

    service.request(input)
    service.request(input)
    assert.equal(calls.length, 1, "Deduplicate in-flight requests")
    assert.match(calls[0]!.prompt, /<latest_user_message>\s+can you explain this test\s+<\/latest_user_message>/)
    assert.match(calls[0]!.prompt, /<latest_assistant_reply>\s+It checks request cancellation\.\s+<\/latest_assistant_reply>/)
    assert.deepEqual({ ...calls[0]!.model }, { providerID: "google-vertex", id: "gemini-3.1-flash-lite", variant: "minimal" })
    calls[0]!.resolve("Can you show an example?")
    await flush()
    assert.equal(prediction()?.primary, "can you show an example?", "Publish parsed results reactively")
    assert.equal(service.get(input.scopeKey, "idle-2"), undefined)
    service.request(input)
    assert.equal(calls.length, 1, "Requests reuse cached predictions")

    service.request({ ...input, force: true })
    assert.equal(prediction(), undefined, "Force clears the cache reactively")
    assert.equal(calls.length, 2)
    calls[1]!.resolve("Could you review those assertions?")
    await flush()
    assert.equal(prediction()?.primary, "could you review those assertions?")

    const next = { ...input, turnID: "idle-2" }
    const other = { ...input, scopeKey: "side-chat/local/other" }
    service.request(next)
    service.request(other)
    assert.equal(calls.length, 4)
    service.cancel(input.scopeKey)
    assert(calls[2]!.signal.aborted)
    assert(!calls[3]!.signal.aborted, "Cancelling one scope leaves other scopes running")
    assert.equal(prediction()?.primary, "could you review those assertions?", "Cancel keeps cached predictions by default")
    calls[2]!.resolve("Stale")
    calls[3]!.resolve("Other")
    await flush()
    assert.equal(service.get(next.scopeKey, next.turnID), undefined, "A cancelled result cannot publish")
    assert.equal(service.get(other.scopeKey, other.turnID)?.primary, "Other")
    service.request(next)
    assert.equal(calls.length, 5, "Cancel allows retrying the same turn")
    setWatchTurn(next.turnID)
    calls[4]!.resolve("Recovered")
    await flush()
    assert.equal(prediction()?.primary, "Recovered")
    service.cancel(next.scopeKey, { clearCache: true })
    assert.equal(prediction(), undefined, "Opting to clear the cache updates observers")

    service.request(next)
    service.request({ ...other, turnID: "idle-2" })
    setEnabled(false)
    assert.equal(observedEnabled, false)
    assert(calls[5]!.signal.aborted)
    assert(calls[6]!.signal.aborted, "Disabling cancels every scope")
    service.request({ ...next, force: true })
    assert.equal(calls.length, 7, "Disabled services do not generate, even when forced")
    calls[5]!.resolve("Disabled")
    calls[6]!.resolve("Also disabled")
    await flush()
    assert.equal(prediction(), undefined)
    setEnabled(true)
    assert.equal(observedEnabled, true)
    service.request(next)
    assert.equal(calls.length, 8, "Re-enabling allows retrying an interrupted turn")
  } finally {
    dispose()
    for (const call of calls) call.resolve("Cleanup")
  }
  assert(calls[7]!.signal.aborted, "Plugin cleanup cancels active scoped requests")
})
