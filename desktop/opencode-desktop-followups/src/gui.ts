import { ComposerPill, Command, Plugin, Store, createKeyed } from "@opencode/plugin/gui"
import type { ComposerPillProps, MountedSession } from "@opencode/plugin/gui"
import { Schema } from "effect"
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { buildPrompt, matchesDraft, type Prediction } from "./model"
import { createSuggestions } from "./request"

function latestMessageID(session: MountedSession) {
  return session.server.data.session.message.list(session.id)
    ?.findLast((message) => message.type === "assistant" || message.type === "user")?.id
}

function attachTooltip(button: HTMLButtonElement, text: string) {
  const tooltip = document.createElement("div")
  // The button's accessible name already includes the full suggestion.
  tooltip.setAttribute("aria-hidden", "true")
  tooltip.dataset.followupTooltip = ""
  tooltip.textContent = text
  Object.assign(tooltip.style, {
    position: "fixed", zIndex: "50", pointerEvents: "none",
    width: "max-content", maxWidth: "min(360px, calc(100vw - 16px))", boxSizing: "border-box",
    padding: "8px 10px", borderRadius: "8px", background: "Canvas", color: "CanvasText",
    boxShadow: "0 2px 12px #0003, 0 0 0 1px #8885", fontSize: "13px", lineHeight: "1.4",
    whiteSpace: "normal", overflowWrap: "anywhere",
  })
  const position = () => {
    const anchor = button.getBoundingClientRect()
    const { width, height } = tooltip.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
    const above = anchor.top - height - 6
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${above >= 8 ? above : anchor.bottom + 6}px`
  }
  const dismiss = () => {
    tooltip.remove()
    document.removeEventListener("keydown", dismissOnEscape)
    window.removeEventListener("resize", position)
  }
  const dismissOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") dismiss()
  }
  const reveal = () => {
    document.body.append(tooltip)
    position()
    document.addEventListener("keydown", dismissOnEscape)
    window.addEventListener("resize", position)
  }
  const revealOnFocus = () => {
    if (button.matches(":focus-visible")) reveal()
  }
  button.addEventListener("pointerenter", reveal)
  button.addEventListener("pointerleave", dismiss)
  button.addEventListener("focus", revealOnFocus)
  button.addEventListener("blur", dismiss)
  if (button.matches(":hover, :focus-visible")) reveal()

  return () => {
    button.removeEventListener("pointerenter", reveal)
    button.removeEventListener("pointerleave", dismiss)
    button.removeEventListener("focus", revealOnFocus)
    button.removeEventListener("blur", dismiss)
    dismiss()
  }
}

export default Plugin.define({
  stores: { prefs: Store.global(Schema.Struct({ enabled: Schema.Boolean }), { enabled: true }) },
  setup(ctx) {
    const [visible, setVisible] = createSignal(document.visibilityState === "visible")
    const updateVisibility = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", updateVisibility)

    const cache = new Map<string, { messageID: ReturnType<typeof latestMessageID>; prediction: Prediction }>()
    const [cacheVersion, updateCache] = createSignal(0)
    const prediction = () => {
      cacheVersion()
      const session = ctx.sessions.current()
      const cached = session && cache.get(session.key)
      if (session && cached && cached.messageID === latestMessageID(session)) return cached.prediction
    }
    const requests = createSuggestions((result) => {
      const session = ctx.sessions.current()
      if (session && result) {
        cache.set(session.key, { messageID: latestMessageID(session), prediction: result })
        updateCache((version) => version + 1)
      }
    }, (error) => console.warn("[desktop-followups] Suggestion generation failed", error))
    const forget = (key: string) => {
      if (cache.delete(key)) updateCache((version) => version + 1)
    }
    const discard = () => {
      const key = ctx.sessions.current()?.key
      if (key) forget(key)
      requests.clear()
    }
    onCleanup(() => {
      requests.clear()
      document.removeEventListener("visibilitychange", updateVisibility)
    })

    const ready = createMemo(() => {
      const session = ctx.sessions.current()
      const composer = ctx.screen.current()?.composer
      if (!session || !composer || !ctx.stores.prefs.value.enabled) return false
      const data = session.server.data.session
      return session.server.connected && !session.pending && !data.get(session.id)?.parentID &&
        data.status(session.id) === "idle" && !data.pending.list(session.id)?.length &&
        !data.permission.list(session.id)?.length && !(data.form.list(session.id)?.length) &&
        !(data.form.list("global")?.length) && composer.quotable()
    })
    createEffect(() => {
      ctx.sessions.current()?.visit
      const enabled = ctx.stores.prefs.value.enabled
      untrack(() => {
        requests.clear()
        if (!enabled) {
          cache.clear()
          updateCache((version) => version + 1)
        }
      })
    })

    const suggest = (manual = false) => {
      const session = ctx.sessions.current()
      if (!session || !ready()) {
        if (manual) ctx.toast.show({ title: "Suggestions unavailable", description: "Wait for the reply to finish, then try again." })
        return
      }
      const visit = session.visit
      const messages = session.server.data.session.message.list(session.id) ?? []
      if (!messages.some((message) => message.type === "assistant")) {
        if (manual) ctx.toast.show({ title: "No assistant messages in loaded conversation" })
        return
      }
      forget(session.key)
      const messageID = latestMessageID(session)
      const { prompt, openingCase } = buildPrompt(messages)
      const model = { providerID: "google-vertex", id: "gemini-3.1-flash-lite", variant: "minimal" }
      void requests.run(
        (signal) => session.server.client.experimental.generate.text({ prompt, model }, { signal }),
        () => ctx.sessions.current()?.visit === visit && ready() && latestMessageID(session) === messageID,
        openingCase,
      )
    }
    const [completion, setCompletion] = createSignal<{ id: string; visit: object }>()
    let consumed: string | undefined
    createEffect(() => {
      const done = completion()
      if (!done || !ready() || ctx.sessions.current()?.visit !== done.visit || consumed === done.id) return
      consumed = done.id
      untrack(() => suggest())
    })
    createKeyed(() => ctx.sessions.current()?.server.data, (data) => {
      onCleanup(data.on("session.execution.started", (event) => {
        const session = ctx.sessions.current()
        if (session?.id !== event.data.sessionID) return
        setCompletion(undefined)
        discard()
      }))
      onCleanup(data.on("session.execution.succeeded", (event) => {
        const session = ctx.sessions.current()
        if (session?.id === event.data.sessionID) setCompletion({ id: event.id, visit: session.visit })
      }))
    })

    const currentPrediction = (input: ComposerPillProps) => {
      if (ready() && visible() && ctx.sessions.current()?.visit === input.session.visit) return prediction()
    }

    // The SDK exposes text but no caret or selection. Insertion is only safe in an empty prompt.
    const accept = (input: ComposerPillProps, text: string) => {
      const composer = input.screen.composer
      if (composer.text() !== "" || !currentPrediction(input)?.choices.includes(text)) return false
      composer.insert(text)
      composer.focus()
    }

    const showPrimary = (input: ComposerPillProps) => {
      const primary = currentPrediction(input)?.primary
      const draft = input.screen.composer.text()
      if (!primary || !matchesDraft(primary, draft)) return
      if (draft) return { label: primary, title: `${primary} · Clear the draft to insert` }
      const shortcut = ctx.keybinds.keybind(`${ctx.id}.accept`).join("+")
      return {
        label: primary,
        title: shortcut ? `${primary} · ${shortcut} in the prompt` : primary,
        run: () => { accept(input, primary) },
      }
    }
    ctx.add(ComposerPill, { id: "primary-suggestion", show: showPrimary })

    createEffect(() => {
      const session = ctx.sessions.current()
      const screen = ctx.screen.current()
      const view = session && screen && showPrimary({ session, screen })
      if (!view) return

      // The 2.3.2 pill SDK exposes its accessible label but no tooltip hook.
      let button: HTMLButtonElement | undefined
      let removeTooltip: (() => void) | undefined
      const syncTooltip = () => {
        const match = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-slot="session-plugin-pill"]:not([aria-haspopup])'))
          .find((pill) => pill.getAttribute("aria-label") === view.title && pill.textContent === view.label)
        if (match === button) return
        removeTooltip?.()
        button = match
        removeTooltip = button && attachTooltip(button, view.label)
      }
      const observer = new MutationObserver(syncTooltip)
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label"] })
      syncTooltip()
      onCleanup(() => {
        observer.disconnect()
        removeTooltip?.()
      })
    })
    ctx.add(ComposerPill, {
      id: "suggestions",
      show(input) {
        const draft = input.screen.composer.text()
        const choices = currentPrediction(input)?.choices.filter((choice) => matchesDraft(choice, draft))
        if (!choices?.length) return
        return {
          label: "Suggested next prompts",
          title: draft ? "Suggested next prompts · Clear the draft to insert" : undefined,
          rows: [...choices.map((text, index) => ({
            id: String(index), label: text,
            run: draft ? undefined : () => { accept(input, text) },
          })), { id: "dismiss", label: "Dismiss suggestions", run() {
            if (ctx.sessions.current()?.visit === input.session.visit) discard()
          } }],
        }
      },
    })
    ctx.add(Command, (): Command => ({
      id: "accept", title: "Accept primary suggestion", bind: "tab", section: "prompt", hidden: true, editable: true,
      enabled: ready() && visible() && !!prediction()?.primary && ctx.screen.current()?.composer.text() === "",
      run() {
        const session = ctx.sessions.current()
        const screen = ctx.screen.current()
        const primary = prediction()?.primary
        if (!session || !screen || !screen.composer.focused() || !primary) return false
        return accept({ session, screen }, primary)
      },
    }))
    ctx.add(Command, () => ({
      id: "suggest", title: "Suggest next prompts", slash: { name: "suggest-next" },
      // Slash dispatch clears its draft after run returns.
      run() { setTimeout(() => { if (!ctx.signal.aborted) suggest(true) }, 0) },
    }))
    ctx.add(Command, () => ({
      id: "toggle", title: `${ctx.stores.prefs.value.enabled ? "Disable" : "Enable"} next-prompt suggestions`,
      run() { ctx.stores.prefs.update((prefs) => { prefs.enabled = !prefs.enabled }) },
    }))
    console.info("[desktop-followups] Loaded")
  },
})
