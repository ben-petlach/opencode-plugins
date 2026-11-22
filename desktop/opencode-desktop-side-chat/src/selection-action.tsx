import type { Context, MountedSession } from "@opencode/plugin/gui"
import { Command } from "@opencode/plugin/gui"
import { createEffect, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js"
import { render } from "solid-js/web"
import { MAX_QUOTE_LENGTH } from "./selection-text.ts"

export function installSelectionAction(ctx: Context, enabled: (session: MountedSession | undefined) => session is MountedSession,
  ask: (session: MountedSession, text: string) => boolean) {
  const owner = getOwner()!
  const ui = ctx.ui
  const [selected, setSelected] = createSignal<{ text: string; session: MountedSession }>()
  const mounts = new Map<HTMLElement, { host: HTMLElement; dispose: () => void }>()
  function readSelection() {
    const session = ctx.sessions.current()
    const selection = window.getSelection()
    if (!enabled(session) || !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return
    const root = document.querySelector('[data-slot="session-timeline-scroll"]')
    if (!root?.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return
    const element = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement
    if (element?.closest('textarea,input,[contenteditable="true"],.oc-side-chat')) return
    const text = selection.toString()
    if (!text.trim()) return
    return { text, session }
  }
  function syncSelection() { setSelected(readSelection()) }
  function run() {
    const value = readSelection()
    if (!value || ctx.sessions.current()?.visit !== value.session.visit) return false
    if (value.text.length > MAX_QUOTE_LENGTH) {
      ctx.toast.show({ title: "Selection too long", description: "Select up to 20,000 characters.", variant: "error" })
      return
    }
    if (!ask(value.session, value.text)) return
    window.getSelection()?.removeAllRanges()
    setSelected(undefined)
  }
  ctx.add(Command, () => ({
    id: "ask-selection", title: "Ask in Side Chat", description: "Open a new side chat with selected main-chat text quoted",
    bind: "mod+alt+s", section: "session" as const, enabled: !!selected(), run,
  }))
  function syncToolbar() {
    for (const [toolbar, mounted] of mounts) {
      if (!toolbar.isConnected) { mounted.dispose(); mounted.host.remove(); mounts.delete(toolbar) }
    }
    // shortcut: OpenCode 2.3.2 has no selection-toolbar slot; upgrade when a public extension point exists.
    for (const toolbar of document.querySelectorAll<HTMLElement>('[data-component="timeline-quote"][role="toolbar"]')) {
      if (mounts.has(toolbar)) continue
      const host = document.createElement("span")
      host.dataset.sidechatSelectionAction = ""
      host.style.display = "inline-flex"
      toolbar.append(host)
      const dispose = runWithOwner(owner, () => render(() => <ui.Tooltip value="Ask in a new side chat" keys={ctx.keybinds.keybind(`${ctx.id}.ask-selection`)}>
        <ui.Button size="small" variant="ghost" icon="speech-bubble" disabled={!selected() || selected()!.text.length > MAX_QUOTE_LENGTH}
          onClick={() => { run() }}>Ask in Side Chat</ui.Button>
      </ui.Tooltip>, host))!
      mounts.set(toolbar, { host, dispose })
    }
  }
  let pending = false
  const observer = new MutationObserver(() => {
    if (pending) return
    pending = true
    queueMicrotask(() => { pending = false; if (!ctx.signal.aborted) syncToolbar() })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener("selectionchange", syncSelection)
  createEffect(() => { ctx.sessions.current()?.visit; setSelected(undefined) })
  syncSelection()
  syncToolbar()
  onCleanup(() => {
    observer.disconnect()
    document.removeEventListener("selectionchange", syncSelection)
    for (const mounted of mounts.values()) { mounted.dispose(); mounted.host.remove() }
    mounts.clear()
  })
}
