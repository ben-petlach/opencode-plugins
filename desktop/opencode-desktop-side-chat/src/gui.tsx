// Adapted from OpenCode PR #62169 by neriousy. See LICENSE.
import type { ModelRef, SessionMessageInfo } from "@opencode/client"
import {
  Command, Ipc, MenuItem, Panel, Plugin, Store, Style,
  type MountedSession, type PanelProps, type PanelTab,
} from "@opencode/plugin/gui"
import { Schema } from "effect"
import { createEffect, createMemo, createSignal, For, getOwner, on, onCleanup, onMount, runWithOwner, Show } from "solid-js"
import { INLINE_BYTES, prepareFiles, type Upload } from "./attachments"
import { SideComposer } from "./composer"
import { SideMessage } from "./message"
import { ExecutionGroup } from "./execution"
import { timelineRows } from "./timeline"
import { conversationLines, legacyLines, mainContext, shareText } from "./conversation"
import styles from "./panel.css?inline"
import { modelOptions, parseModelPreferences } from "./models"
import { installSelectionAction } from "./selection-action"
import { quoteDraft } from "./selection-text"
import { installSideChatActivity } from "./activity"

const ModelPreferences = Ipc.define({
  id: "opencode-desktop-side-chat.models",
  methods: { read: { output: Schema.String } },
})

const Model = Schema.Struct({ providerID: Schema.String, id: Schema.String, variant: Schema.optional(Schema.String) })
const LegacyTurn = Schema.Struct({ question: Schema.String, answer: Schema.String })
const Thread = Schema.Struct({
  turns: Schema.Array(LegacyTurn),
  draft: Schema.String,
  mentions: Schema.optional(Schema.Array(Schema.String)),
  sessionID: Schema.optional(Schema.String),
  model: Schema.optional(Model),
  updates: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, afterID: Schema.optional(Schema.String), time: Schema.Number }))),
})

const Catalog = Schema.Struct({
  items: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  active: Schema.String,
})

const reservedCommands = new Set(["sidechat", "btw", "btw-clear", "open-side-chat", "opencode-desktop-side-chat.open", "sidechat-new"])
const pageSize = 80
const mainContextKey = "desktop-side-chat-context"

const activityErrors = {
  sending: "Couldn’t send side message",
  sharing: "Couldn’t share side chat",
  updating: "Couldn’t update from main chat",
}
type Activity = keyof typeof activityErrors

function modelKey(model: ModelRef | undefined) {
  return model ? `${model.providerID}/${model.id}` : ""
}

function canOpen(session: MountedSession | undefined): session is MountedSession {
  return !!session && !session.pending && !session.server.data.session.get(session.id)?.metadata?.desktopSideChatParent
}

async function readConversation(session: MountedSession, id: string, signal: AbortSignal) {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  do {
    const page = await session.server.client.message.list({
      sessionID: id,
      limit: 100,
      ...(cursor ? { cursor } : { order: "asc" }),
    }, { signal })
    messages.push(...page.data)
    cursor = page.data.length === 100 ? page.cursor.next ?? undefined : undefined
  } while (cursor)
  return conversationLines(messages)
}

export default Plugin.define({
  main(ctx) {
    const { app } = require("electron")
    const { join } = require("node:path")
    const { DatabaseSync } = require("node:sqlite")
    // shortcut: OpenCode 2.3.2 exposes no model-preference API; read its store without writing it.
    ctx.provide(ModelPreferences, {
      read() {
        const db = new DatabaseSync(join(app.getPath("userData"), "drafts.sqlite"), { readOnly: true })
        try {
          const row = db.prepare("SELECT value FROM state WHERE name = ? AND key = ?")
            .get("opencode.global.dat", "model")
          return row?.value ?? "{}"
        } finally {
          db.close()
        }
      },
    })
  },
  stores: {
    thread: Store.session(Thread, { turns: [], draft: "" }),
    chats: Store.session(Catalog, { items: [{ id: "main", title: "Side chat 1" }], active: "main" }),
  },
  setup(ctx) {
    createEffect(() => {
      for (const id of ctx.servers.list()) {
        const server = ctx.servers.get(id)
        if (server) onCleanup(installSideChatActivity(server.data))
      }
    })
    const [activities, setActivities] = createSignal(new Map<string, Activity>())
    const [uploads, setUploads] = createSignal(new Map<string, Upload[]>())
    const tabs = new Map<string, PanelTab>()
    const panelKey = (id: string) => `${ctx.id}:${id}`
    const editorID = (session: MountedSession, chatID: string) => `oc-side-editor-${session.id}-${chatID}`
    const owner = getOwner()!
    const catalogs = new Map<string, ReturnType<typeof ctx.stores.chats>>()
    const threads = new Map<string, ReturnType<typeof ctx.stores.thread>>()
    function catalogStore(session: MountedSession) {
      let saved = catalogs.get(session.key)
      if (!saved) {
        saved = runWithOwner(owner, () => ctx.stores.chats(session))!
        catalogs.set(session.key, saved)
      }
      return saved
    }
    function threadStore(session: MountedSession, chatID: string) {
      const key = `${session.key}:${chatID}`
      let saved = threads.get(key)
      if (!saved) {
        saved = runWithOwner(owner, () => chatID === "main" ? ctx.stores.thread(session)
          : ctx.storage.store(`thread.${chatID}`, { schema: Thread, initial: { turns: [], draft: "" }, scope: { session } }))!
        threads.set(key, saved)
      }
      return saved
    }

    function openChat(session: MountedSession, chatID?: string) {
      const catalog = catalogStore(session)
      const id = chatID ?? catalog.value?.active ?? "main"
      ctx.layout.open(panelKey(id), session, { tab: "select" })
    }
    function newChat(session: MountedSession, draft = "") {
      const catalog = catalogStore(session)
      if (!catalog.ready()) {
        report("Side chats are loading", "Try the selection action again in a moment.")
        return
      }
      const id = crypto.randomUUID()
      catalog.update(current => {
        current.items.push({ id, title: `Side chat ${current.items.length + 1}` })
        current.active = id
      })
      if (draft) threadStore(session, id).update(current => { current.draft = draft })
      openChat(session, id)
      return id
    }
    function focusComposer(session: MountedSession, chatID: string) {
      catalogStore(session).update(current => { current.active = chatID })
      let attempts = 0
      const focus = () => {
        if (ctx.signal.aborted || ctx.sessions.current()?.key !== session.key) return
        const editor = document.getElementById(editorID(session, chatID)) as HTMLTextAreaElement | null
        if (editor && !editor.disabled) editor.focus()
        else if (++attempts < 30) requestAnimationFrame(focus)
      }
      requestAnimationFrame(focus)
    }

    function report(title: string, error: unknown) {
      if (ctx.signal.aborted) return
      ctx.toast.show({
        variant: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      })
    }

    async function perform(key: string, activity: Activity, action: () => Promise<void>) {
      if (activities().has(key)) return
      setActivities(previous => new Map(previous).set(key, activity))
      try {
        await action()
      } catch (error) {
        report(activityErrors[activity], error)
      } finally {
        setActivities(previous => {
          const next = new Map(previous)
          next.delete(key)
          return next
        })
      }
    }

    function updateUploads(key: string, change: (files: Upload[]) => Upload[]) {
      setUploads(previous => {
        const next = new Map(previous)
        const files = change(next.get(key) ?? [])
        if (files.length) next.set(key, files)
        else next.delete(key)
        return next
      })
    }

    function SidePanel(props: { session: MountedSession; screen: PanelProps["screen"]; chatID: string }) {
      const session = props.session
      const server = session.server
      const client = server.client
      const data = server.data
      const ui = ctx.ui
      const chatID = props.chatID
      const key = `${session.key}:${chatID}`
      const saved = threadStore(session, chatID)
      const catalog = catalogStore(session)
      const title = () => catalog.value?.items.find(item => item.id === chatID)?.title ?? "Side chat"
      const location = () => session.location ?? { directory: session.directory }
      const sideID = () => saved.value?.sessionID
      const [syncError, setSyncError] = createSignal(false)
      const [refresh, setRefresh] = createSignal(0)
      const [lastSubmitted, setLastSubmitted] = createSignal(0)
      const [messages, setMessages] = createSignal<SessionMessageInfo[]>([])
      const [olderCursor, setOlderCursor] = createSignal<string>()
      let scroller: HTMLDivElement | undefined
      let transcript: HTMLDivElement | undefined
      let followOutput = true
      function scrollToLatest() {
        followOutput = true
        if (scroller) scroller.scrollTop = scroller.scrollHeight
      }
      onMount(() => {
        const observer = new ResizeObserver(() => {
          if (followOutput) scrollToLatest()
        })
        observer.observe(scroller!)
        observer.observe(transcript!)
        onCleanup(() => observer.disconnect())
      })

      const rows = createMemo(() => [
        ...legacyLines(saved.value?.turns ?? []).map(line => ({ type: "message" as const, id: line.id, line })),
        ...timelineRows(messages(), saved.value?.updates ?? []),
      ])
      const row = (id: string) => rows().find(item => item.id === id)!
      const [success, setSuccess] = createSignal<string>()
      let successTimer: ReturnType<typeof setTimeout> | undefined
      onCleanup(() => clearTimeout(successTimer))
      function succeeded(action: string) {
        setSuccess(action)
        clearTimeout(successTimer)
        successTimer = setTimeout(() => setSuccess(undefined), 2000)
      }
      const activity = () => activities().get(key)
      const side = () => {
        const id = sideID()
        return id ? data.session.get(id) : undefined
      }
      const lines = createMemo(() => [...legacyLines(saved.value?.turns ?? []), ...conversationLines(messages())])
      const permissions = () => {
        const id = sideID()
        return id ? data.session.permission.list(id) : []
      }
      const forms = () => {
        const id = sideID()
        return id ? data.session.form.list(id, location()) ?? [] : []
      }
      const running = () => {
        const id = sideID()
        if (!id) return false
        return data.session.status(id) === "running" || data.session.pending.list(id).some(item =>
          data.session.pending.status(id, item.id) === "starting",
        )
      }
      const model = (): ModelRef | undefined => {
        const chosen = saved.value?.model ?? side()?.model
        if (chosen) return chosen
        const main = props.screen.composer.model()
        if (main) return { providerID: main.providerID, id: main.modelID, variant: main.variant }
        return data.session.get(session.id)?.model
      }
      const models = () => (data.location.model.list(location()) ?? []).filter(item => item.enabled)
      const selectedModel = () => {
        const key = modelKey(model())
        return models().find(item => modelKey(item) === key)
      }
      const providerName = (id: string) =>
        data.location.provider.list(location())?.find(provider => provider.id === id)?.name ?? id
      const modelLabel = () => {
        const current = model()
        return current ? `${providerName(current.providerID)} / ${selectedModel()?.name ?? current.id}` : "Choose model"
      }
      const commands = () => (data.location.command.list(location()) ?? []).filter(item => !reservedCommands.has(item.name.toLowerCase()))
      const draftUploads = () => uploads().get(key) ?? []
      const newestError = () => {
        if (running()) return undefined
        const last = messages().findLast(message => message.type === "assistant" || message.type === "user" || message.type === "shell")
        if (last?.type === "assistant" && last.error) return last.error.message
      }

      createEffect(() => {
        const ref = location()
        void Promise.all([
          data.location.model.sync(ref),
          data.location.provider.sync(ref),
          data.location.command.sync(ref),
        ]).catch(error => report("Couldn’t load side chat controls", error))
      })

      createEffect(() => {
        refresh()
        const id = sideID()
        if (!id) return
        const ref = location()
        void Promise.all([
          data.session.sync(id, { children: false }),
          data.session.pending.sync(id),
          data.session.permission.sync(id),
          data.session.form.sync(id, ref),
        ]).then(() => {
          if (sideID() !== id) return
          if (data.session.missing(id)) {
            saved.update(thread => { delete thread.sessionID })
            report("Side session is unavailable", "The next message will start a new side session.")
          }
          setSyncError(false)
        }).catch(error => {
          if (sideID() !== id) return
          setSyncError(true)
          report("Couldn’t load side chat", error)
        })
      })

      createEffect(on(sideID, () => {
        setMessages([])
        setOlderCursor(undefined)
      }))

      createEffect(() => {
        const id = sideID()
        const isRunning = running()
        lastSubmitted()
        refresh()
        if (!id) return
        const sessionID = id
        const controller = new AbortController()
        const signal = controller.signal
        let loading = false
        async function refreshMessages() {
          if (loading) return
          loading = true
          try {
            const page = await client.message.list({ sessionID, limit: pageSize, order: "desc" }, { signal })
            if (signal.aborted) return
            const latest = page.data.toReversed()
            setMessages(previous => {
              if (!previous.length && latest.length === pageSize) setOlderCursor(page.cursor.next ?? undefined)
              const first = latest[0]?.id
              const prefix = first ? previous.findIndex(item => item.id === first) : -1
              return prefix > 0 ? [...previous.slice(0, prefix), ...latest] : latest
            })
          } catch (error) {
            if (!signal.aborted) report("Couldn’t fetch side messages", error)
          } finally {
            loading = false
          }
        }
        void refreshMessages()
        const timer = isRunning ? window.setInterval(() => void refreshMessages(), 500) : undefined
        onCleanup(() => {
          window.clearInterval(timer)
          controller.abort()
        })
      })

      async function chooseModel() {
        const current = modelKey(model())
        let preferences
        try {
          preferences = parseModelPreferences(await ctx.main(ModelPreferences).read({ signal: ctx.signal }))
        } catch (error) {
          report("Couldn’t load main chat model shortlist", error)
          return
        }
        const options = modelOptions(models(), preferences, providerName)
        const key = await ctx.dialogs.select({
          title: "Choose side chat model",
          placeholder: "Search models",
          options,
          current,
        })
        const selected = models().find(item => modelKey(item) === key)
        if (!selected || key === current || running() || activity()) return
        saved.update(thread => {
          thread.model = { id: selected.id, providerID: selected.providerID }
        })
      }

      async function chooseVariant() {
        const current = model()
        const variants = selectedModel()?.variants
        if (!current || !variants?.length) return
        const variant = await ctx.dialogs.select({
          title: "Choose side chat model variant",
          options: [{ title: "Default", value: "" }, ...variants.map(item => ({ title: item.id, value: item.id }))],
          current: current.variant ?? "",
        })
        if (variant === undefined || running() || activity()) return
        saved.update(thread => { thread.model = { ...current, variant: variant || undefined } })
      }

      function addUploads(files: readonly File[]) {
        const accepted = files.filter(file => file.size <= INLINE_BYTES)
        if (accepted.length < files.length) report("Attachment too large", "Choose files up to 20 MB each.")
        updateUploads(key, previous => [
          ...previous,
          ...accepted.map(file => ({ id: crypto.randomUUID(), file })),
        ])
      }

      async function saveMainSnapshot(
        id: string,
        context: readonly SessionMessageInfo[],
        turns: typeof Thread.Type["turns"],
        signal: AbortSignal,
      ) {
        await client.experimental.session.instructions.entry.put({
          sessionID: id,
          key: mainContextKey,
          value: mainContext(context, turns),
        }, { signal })
      }

      async function ensureSideSession(thread: typeof Thread.Type, model: ModelRef, signal: AbortSignal) {
        if (thread.sessionID) {
          const existing = await client.session.get({ sessionID: thread.sessionID }, { signal })
          if (existing.agent === "plan") await client.session.switchAgent({ sessionID: thread.sessionID, agent: "build" }, { signal })
          return thread.sessionID
        }
        const context = await client.session.context({ sessionID: session.id }, { signal })
        const parent = data.session.get(session.id)
        const created = await client.session.create({
          location: location(),
          title: `${title()} · ${parent?.title || "Session"}`.slice(0, 140),
          model,
          agent: "build",
          metadata: { desktopSideChatParent: session.id, desktopSideChatID: chatID },
        }, { signal })
        data.session.remember(created)
        try {
          await client.session.update({ sessionID: created.id, archived: true }, { signal })
          await saveMainSnapshot(created.id, context, thread.turns, signal)
        } catch (error) {
          await client.session.remove({ sessionID: created.id }, { signal: AbortSignal.timeout(5_000) })
            .catch(() => undefined)
          throw error
        }
        saved.update(current => {
          current.sessionID = created.id
          current.model = model
        })
        return created.id
      }

      function updateFromMain() {
        const thread = saved.value
        const id = thread?.sessionID
        if (!id || running() || syncError() || !canOpen(session)) return
        void perform(key, "updating", async () => {
          const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(60_000)])
          const context = await client.session.context({ sessionID: session.id }, { signal })
          await saveMainSnapshot(id, context, thread.turns, signal)
          saved.update(current => {
            current.updates = [...(current.updates ?? []), { id: crypto.randomUUID(), afterID: messages().at(-1)?.id, time: Date.now() }]
          })
          succeeded("updating")
        })
      }

      function send() {
        const thread = saved.value
        const attached = draftUploads()
        const text = thread?.draft.trim() ?? ""
        if (!thread || running() || syncError() || !canOpen(session)
          || !(text || thread.mentions?.length || attached.length)) return

        const slash = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text)
        if (slash && reservedCommands.has(slash[1].toLowerCase())) {
          report("Side chat is already open", "Continue this conversation here.")
          return
        }
        if (slash && !commands().some(command => command.name === slash[1])) {
          report("Command unavailable in side chat", `/${slash[1]} is not a session command here.`)
          return
        }
        if (text.startsWith("!") && (!text.slice(1).trim() || attached.length || thread.mentions?.length)) {
          report("Shell command unavailable", "Enter a command without attachments.")
          return
        }
        const selected = model()
        const modalities = selectedModel()?.capabilities.input ?? []

        void perform(key, "sending", async () => {
          scrollToLatest()
          const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(120_000)])
          const files = await prepareFiles(session, thread.mentions ?? [], attached, modalities, signal)
          const fallback = selected ? undefined : (await client.model.default({ location: location() }, { signal })).data
          const effectiveModel = selected ?? (fallback && { providerID: fallback.providerID, id: fallback.id })
          if (!effectiveModel) throw new Error("Choose an available side chat model.")
          const id = await ensureSideSession(thread, effectiveModel, signal)
          const sideModel = data.session.get(id)?.model
          if (modelKey(sideModel) !== modelKey(effectiveModel) || sideModel?.variant !== effectiveModel.variant) {
            await client.session.switchModel({ sessionID: id, model: effectiveModel }, { signal })
          }

          if (text.startsWith("!")) {
            if (files.length) throw new Error("Shell commands cannot include attachments.")
            await client.session.shell({ sessionID: id, command: text.slice(1).trim() }, { signal })
          } else if (slash) {
            await client.session.command({ sessionID: id, name: slash[1], text: slash[2] ?? "", files }, { signal })
          } else {
            await data.session.prompt({ sessionID: id, text, files })
          }
          const sent = new Set(attached.map(file => file.id))
          updateUploads(key, remaining => remaining.filter(file => !sent.has(file.id)))
          saved.update(current => {
            if (current.draft === thread.draft) current.draft = ""
            current.mentions = current.mentions?.filter(path => !thread.mentions?.includes(path))
          })
          setLastSubmitted(Date.now())
        })
      }

      function share() {
        const id = sideID()
        const legacy = legacyLines(saved.value?.turns ?? [])
        if (!id && !legacy.length) return

        void perform(key, "sharing", async () => {
          const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(60_000)])
          const snapshot = id ? [...legacy, ...await readConversation(session, id, signal)] : legacy
          if (snapshot.length === 0) return
          if (ctx.sessions.current()?.visit !== session.visit) {
            report("Main chat changed", "Return to the original main chat and share again.")
            return
          }
          const composer = props.screen.composer
          if (!composer.quotable()) {
            report("Main draft unavailable", "Exit shell mode before adding the side chat.")
            return
          }
          composer.insert(`${composer.text().trim() ? "\n\n" : ""}${shareText(snapshot)}\n\n`)
          composer.focus()
          succeeded("sharing")
        })
      }

      const reply = (requestID: string, decision: "once" | "reject") => {
        const id = sideID()
        if (id) void data.session.permission.reply({ sessionID: id, requestID, decision })
          .catch(error => report("Couldn’t answer permission request", error))
      }

      const skip = (formID: string) => {
        const id = sideID()
        if (id) void data.session.form.cancel({ sessionID: id, formID }, location())
          .catch(error => report("Couldn’t skip the question", error))
      }

      const stop = () => {
        const id = sideID()
        if (id) void client.session.interrupt({ sessionID: id }, { signal: ctx.signal })
          .catch(error => report("Couldn’t stop side response", error))
      }

      async function loadEarlier() {
        const id = sideID()
        const cursor = olderCursor()
        if (!id || !cursor) return
        try {
          const page = await client.message.list({ sessionID: id, limit: pageSize, cursor }, { signal: ctx.signal })
          if (sideID() !== id || olderCursor() !== cursor) return
          setMessages(previous => [...page.data.toReversed(), ...previous])
          setOlderCursor(page.data.length === pageSize ? page.cursor.next ?? undefined : undefined)
        } catch (error) {
          report("Couldn’t load earlier messages", error)
        }
      }

      return (
        <section class="oc-side-chat" aria-label="Side chat">
          <header class="oc-side-header oc-side-header-compact">
            <ui.Menu label="Side chats" icon="speech-bubble" placement="bottom-start" items={[
              ...(catalog.value?.items ?? []).map(item => ({ label: item.title, onSelect: () => openChat(session, item.id) })),
              { type: "separator" },
              { label: "New side chat", icon: "plus", onSelect: () => newChat(session) },
            ]} />
            <ui.Tooltip value="New side chat"><ui.IconButton label="New side chat" icon="plus" size="small" onClick={() => newChat(session)} /></ui.Tooltip>
            <span class="oc-side-header-spacer" />
            <ui.Tooltip value={success() === "updating" ? "Main chat context updated" : "Update from main"}>
              <ui.IconButton icon={success() === "updating" ? "check" : "refresh"} label="Update from main" size="small"
                busy={activity() === "updating"} disabled={!sideID() || syncError() || !!activity() || running()} onClick={updateFromMain} />
            </ui.Tooltip>
            <ui.Tooltip value={success() === "sharing" ? "Added to main draft" : "Add side chat to main draft"}>
              <ui.IconButton icon={success() === "sharing" ? "check" : "outline-share"} label="Share with agent" size="small"
                busy={activity() === "sharing"} disabled={!lines().length || !!activity() || running() || !props.screen.composer.quotable()} onClick={share} />
            </ui.Tooltip>
          </header>
          <div class="oc-side-transcript" ref={scroller} aria-label="Side chat transcript" onScroll={() => {
            if (scroller) followOutput = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160
          }}>
            <div ref={transcript}>
              <Show when={olderCursor()}>
                <ui.Button type="button" variant="ghost" size="small" onClick={() => void loadEarlier()}>Load earlier messages</ui.Button>
              </Show>
              <Show when={syncError()}>
                <ui.Button type="button" variant="neutral" size="small" onClick={() => setRefresh(n => n + 1)}>Retry loading side chat</ui.Button>
              </Show>
              <Show when={saved.ready()} fallback={<p role="status">Loading side chat…</p>}>
                <For each={rows().map(item => item.id)}>{id => <>
                  <Show when={row(id).type === "execution" ? row(id) as Extract<ReturnType<typeof rows>[number], { type: "execution" }> : undefined}>{item =>
                    <ExecutionGroup ctx={ctx} entries={item().entries} />
                  }</Show>
                  <Show when={row(id).type === "update" ? row(id) as Extract<ReturnType<typeof rows>[number], { type: "update" }> : undefined}>{item =>
                    <div class="oc-side-context-update" role="note"><ui.Icon name="refresh" size="small" />
                      <span>Main chat context updated</span><time dateTime={new Date(item().update.time).toISOString()}>{new Date(item().update.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                    </div>
                  }</Show>
                  <Show when={row(id).type === "message" ? row(id) as Extract<ReturnType<typeof rows>[number], { type: "message" }> : undefined}>{item =>
                    <SideMessage ctx={ctx} line={item().line} messages={messages()}
                      modelName={(provider, modelID) => models().find(model => model.providerID === provider && model.id === modelID)?.name ?? modelID}
                      quote={text => {
                        saved.update(thread => { thread.draft = [thread.draft, text.split("\n").map(line => `> ${line}`).join("\n")].filter(Boolean).join("\n\n") + "\n\n" })
                        queueMicrotask(() => document.getElementById(editorID(session, chatID))?.focus())
                      }} />
                  }</Show>
                </>}</For>
                <Show when={activity() === "sending" || running()}>
                  <p class="oc-side-status" role="status"><ui.Loader /> {activity() === "sending" ? "Sending…" : "Working…"}</p>
                </Show>
                <Show when={newestError()}>{error => <p class="oc-side-error" role="alert">{error()}</p>}</Show>
              </Show>
            </div>
          </div>
          <For each={permissions()}>{request => (
            <div class="oc-side-request">
              <p>Allow <b>{request.action}</b>?</p>
              <p class="oc-side-request-detail">{request.resources.join(", ")}</p>
              <div>
                <ui.Button type="button" size="small" variant="neutral" onClick={() => reply(request.id, "reject")}>Reject</ui.Button>
                <ui.Button type="button" size="small" variant="contrast" onClick={() => reply(request.id, "once")}>Allow once</ui.Button>
              </div>
            </div>
          )}</For>
          <For each={forms()}>{form => (
            <div class="oc-side-request">
              <p>{form.title}</p>
              <div>
                <ui.Button type="button" size="small" variant="neutral" onClick={() => skip(form.id)}>Skip</ui.Button>
                <ui.Button type="button" size="small" variant="contrast"
                  onClick={() => ctx.tabs.open({ server: server.id, id: form.sessionID }, { focus: true })}>Open form in session</ui.Button>
              </div>
            </div>
          )}</For>
          <SideComposer
            ctx={ctx}
            session={session}
            editorID={editorID(session, chatID)}
            draft={saved.value?.draft ?? ""}
            mentions={saved.value?.mentions ?? []}
            uploads={draftUploads()}
            modelLabel={modelLabel()}
            model={selectedModel()}
            variantLabel={model()?.variant ?? "Default"}
            commands={commands()}
            disabled={!saved.ready() || syncError() || !!activity()}
            preparing={activity() === "sending"}
            running={running()}
            onDraft={value => saved.update(thread => { thread.draft = value })}
            onMention={path => saved.update(thread => { thread.mentions = [...new Set([...(thread.mentions ?? []), path])] })}
            onRemoveMention={path => saved.update(thread => { thread.mentions = thread.mentions?.filter(item => item !== path) })}
            onUpload={addUploads}
            onRemoveUpload={id => updateUploads(key, files => files.filter(file => file.id !== id))}
            onModel={() => void chooseModel().catch(error => report("Couldn’t choose a model", error))}
            onVariant={() => void chooseVariant().catch(error => report("Couldn’t choose a variant", error))}
            onSend={send}
            onStop={stop}
          />
        </section>
      )
    }

    installSelectionAction(ctx, canOpen, (session, text) => {
      const draft = quoteDraft(text)
      return draft ? !!newChat(session, draft) : false
    })
    ctx.add(Style, styles)
    ctx.add(Command, (): Command => ({
      id: "open",
      title: "Open side chat",
      description: "Open a conversation about this session",
      keywords: "btw aside",
      slash: { name: "sidechat" },
      enabled: canOpen(ctx.sessions.current()),
      run: () => {
        const session = ctx.sessions.current()
        if (canOpen(session)) openChat(session)
      },
    }))

    ctx.add(Command, (): Command => ({
      id: "new", title: "New side chat", description: "Start an independent side conversation", slash: { name: "sidechat-new" },
      enabled: canOpen(ctx.sessions.current()) && !!ctx.sessions.current() && catalogStore(ctx.sessions.current()!).ready(),
      run() { const session = ctx.sessions.current(); if (canOpen(session)) newChat(session) },
    }))
    ctx.add(MenuItem, (): MenuItem | undefined => {
      const session = ctx.sessions.current()
      if (!canOpen(session)) return
      return { menu: "session.panel", id: "new", title: "New side chat", icon: "speech-bubble", run: () => newChat(session) }
    })

    ctx.add(Panel, {
      id: "main",
      region: "side",
      width: 520,
      focus: input => focusComposer(input.session, input.tab.id),
      enter: input => focusComposer(input.session, input.tab.id),
      list({ open, session }) {
        if (!canOpen(session)) return []
        const items = catalogStore(session).value?.items ?? [{ id: "main", title: "Side chat 1" }]
        return items.filter(item => open.includes(item.id)).map(item => {
          const key = `${session.key}:${item.id}`
          let tab = tabs.get(key)
          if (!tab) { tab = { id: item.id, title: item.title, closable: "compact", fallback: true }; tabs.set(key, tab) }
          return tab
        })
      },
      render: props => (
        <Show when={canOpen(props.session) ? `${props.session.key}:${props.tab.id}` : undefined} keyed>
          {_key => <SidePanel session={props.session} screen={props.screen} chatID={props.tab.id} />}
        </Show>
      ),
    })
  },
})
