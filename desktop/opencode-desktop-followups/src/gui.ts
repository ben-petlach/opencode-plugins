import { ComposerPill, Command, Plugin, Store } from "@opencode/plugin/gui"
import type { ComposerPillProps } from "@opencode/plugin/gui"
import { Schema } from "effect"
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { buildPrompt, matchesDraft, type Prediction } from "./model"
import { createSuggestions } from "./request"

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
  stores: {
    prefs: Store.global(Schema.Struct({ enabled: Schema.Boolean }), { enabled: true }),
    dismissal: Store.session(Schema.Struct({ turnID: Schema.NullOr(Schema.String) }), { turnID: null }),
  },
  setup(ctx) {
    const [visible, setVisible] = createSignal(document.visibilityState === "visible")
    const updateVisibility = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", updateVisibility)

    const messages = createMemo(() => {
      const session = ctx.sessions.current()
      return session?.server.data.session.message.list(session.id)
    })
    const latest = createMemo(() =>
      messages()?.findLast((message) => message.type === "idle" || message.type === "assistant" || message.type === "user"))
    const cache = new Map<string, { turnID: string; prediction: Prediction }>()
    const [cacheVersion, updateCache] = createSignal(0)
    const save = (sessionKey: string, turnID: string, prediction: Prediction) => {
      cache.set(sessionKey, { turnID, prediction })
      updateCache((version) => version + 1)
    }
    const prediction = () => {
      cacheVersion()
      const session = ctx.sessions.current()
      if (!session) return
      const turn = latest()
      const cached = cache.get(session.key)
      if (turn && cached?.turnID === turn.id && ctx.stores.dismissal(session).value?.turnID !== turn.id) return cached.prediction
    }
    const requests = createSuggestions((result) => {
      const session = ctx.sessions.current()
      const turn = latest()
      if (session && turn && result) save(session.key, turn.id, result)
    }, (error) => console.warn("[desktop-followups] Suggestion generation failed", error))
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

    let attempted: string | undefined
    const suggest = (manual = false) => {
      const session = ctx.sessions.current()
      if (!session || !ready()) {
        if (manual) ctx.toast.show({ title: "Suggestions unavailable", description: "Wait for the reply to finish, then try again." })
        return
      }
      const history = messages() ?? []
      const turn = latest()
      if (!turn || !history.some((message) => message.type === "assistant")) {
        if (manual) ctx.toast.show({ title: "No assistant messages in loaded conversation" })
        return
      }
      attempted = turn.id
      if (manual) {
        if (cache.delete(session.key)) updateCache((version) => version + 1)
        const dismissal = ctx.stores.dismissal(session)
        if (dismissal.value?.turnID === turn.id) dismissal.update((value) => { value.turnID = null })
      }
      const { prompt, openingCase } = buildPrompt(history)
      const model = { providerID: "google-vertex", id: "gemini-3.1-flash-lite", variant: "minimal" }
      void requests.run(
        (signal) => session.server.client.experimental.generate.text({ prompt, model }, { signal }),
        () => ctx.sessions.current()?.visit === session.visit && latest()?.id === turn.id,
        openingCase,
      )
    }

    let lastVisit: object | undefined
    let wasEnabled = false
    createEffect(() => {
      const session = ctx.sessions.current()
      const enabled = ctx.stores.prefs.value.enabled
      const dismissal = session && ctx.stores.dismissal(session).value
      const turn = latest()
      const history = messages()
      const canGenerate = ready() && visible()

      untrack(() => {
        if (session?.visit !== lastVisit || enabled !== wasEnabled) {
          lastVisit = session?.visit
          wasEnabled = enabled
          attempted = undefined
          requests.clear()
        }
        // The idle message persists when a session finishes outside the current view.
        if (!canGenerate || !session || turn?.type !== "idle" || turn.outcome !== "succeeded" ||
            !dismissal || dismissal.turnID === turn.id || attempted === turn.id ||
            cache.get(session.key)?.turnID === turn.id) return

        const reply = history?.slice(0, history.lastIndexOf(turn))
          .findLast((message) => message.type === "assistant" || message.type === "idle" || message.type === "user")
        if (reply?.type === "assistant" && reply.content.some((part) => part.type === "text" && part.text.trim())) suggest()
      })
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
            const turn = latest()
            if (turn && ctx.sessions.current()?.visit === input.session.visit) {
              requests.clear()
              ctx.stores.dismissal(input.session).update((value) => { value.turnID = turn.id })
            }
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
