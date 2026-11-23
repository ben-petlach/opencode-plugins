import type { CommandInfo, FileListOutput, ModelInfo } from "@opencode/client"
import type { Context, MountedSession } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { Upload } from "./attachments"
import { mentionKey, mentionLabel, mentionOptions, type Mention } from "./mentions"

type Suggestion = { value: string; label: string; description?: string; group?: string; mention?: Mention }
type Trigger = { kind: "mention" | "command"; start: number; end: number; query: string }

type Props = {
  ctx: Context
  session: MountedSession
  editorID: string
  draft: string
  mentions: readonly Mention[]
  uploads: readonly Upload[]
  modelLabel: string
  model: ModelInfo | undefined
  variantLabel: string
  commands: readonly CommandInfo[]
  disabled: boolean
  preparing: boolean
  running: boolean
  onDraft: (text: string) => void
  onMention: (mention: Mention) => void
  onRemoveMention: (path: string) => void
  onUpload: (files: readonly File[]) => void
  onRemoveUpload: (id: string) => void
  onModel: () => void
  onVariant: () => void
  onSend: () => void
  onStop: () => void
}

function findTrigger(value: string, caret: number): Trigger | undefined {
  const before = value.slice(0, caret)
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (mention) {
    const start = before.length - mention[1].length - 1
    const rest = /^[^\s@]*/.exec(value.slice(caret))?.[0] ?? ""
    return { kind: "mention", start, end: caret + rest.length, query: mention[1] }
  }
  const command = /^\s*\/([^\s/]*)$/.exec(before)
  if (command && !/\S/.test(value.slice(caret))) {
    return { kind: "command", start: before.lastIndexOf("/"), end: caret, query: command[1] }
  }
}

export function SideComposer(props: Props) {
  const ui = props.ctx.ui
  const [caret, setCaret] = createSignal(0)
  const [focused, setFocused] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const [files, setFiles] = createSignal<Pick<FileListOutput["data"][number], "path" | "type">[]>([])
  const [searching, setSearching] = createSignal(false)
  const [searchError, setSearchError] = createSignal(false)
  let editor: HTMLTextAreaElement | undefined
  let picker: HTMLInputElement | undefined

  const trigger = createMemo(() => focused() && !dismissed() && !props.disabled
    ? findTrigger(props.draft, caret())
    : undefined)
  const suggestions = createMemo<Suggestion[]>(() => {
    const active = trigger()
    if (!active) return []
    if (active.kind === "mention") {
      const data = props.session.server.data
      const location = props.session.location ?? { directory: props.session.directory }
      return mentionOptions(active.query, {
        references: data.location.reference.list(location) ?? [],
        skills: data.location.skill.list(location) ?? [],
        agents: data.location.agent.list(location) ?? [],
        sessions: data.session.list(), files: files(), currentID: props.session.id, directory: props.session.directory,
      })
    }
    const query = active.query.toLowerCase()
    return props.commands
      .filter(command => command.name.toLowerCase().includes(query))
      .slice(0, 12)
      .map(command => ({ value: command.name, label: `/${command.name}`, description: command.description }))
  })

  createEffect(() => {
    const active = trigger()
    setSelected(0)
    setFiles([])
    setSearching(active?.kind === "mention")
    setSearchError(false)
    if (active?.kind !== "mention") return

    const session = props.session
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const signal = controller.signal
      const location = session.location ?? { directory: session.directory }
      const data = session.server.data
      const client = session.server.client
      const results = await Promise.allSettled([
        data.location.reference.sync(location),
        data.location.skill.sync(location),
        data.location.agent.sync(location),
        (async () => {
          const result = active.query
            ? await client.file.find({ location, query: active.query, limit: 12 }, { signal })
            : await client.file.list({ location }, { signal })
          if (!signal.aborted) setFiles(result.data.slice(0, 12))
        })(),
        (async () => {
          const result = await client.session.list({ parentID: null, archived: false, limit: 50,
            ...(active.query ? { search: active.query } : {}) }, { signal })
          if (!signal.aborted) result.data.forEach(data.session.remember)
        })(),
      ])
      if (!signal.aborted) {
        setSearchError(results.some(result => result.status === "rejected"))
        setSearching(false)
      }
    }, 120)
    onCleanup(() => {
      window.clearTimeout(timer)
      controller.abort()
    })
  })

  function replace(start: number, end: number, text: string) {
    props.onDraft(props.draft.slice(0, start) + text + props.draft.slice(end))
    const position = start + text.length
    setCaret(position)
    queueMicrotask(() => {
      editor?.focus()
      editor?.setSelectionRange(position, position)
    })
  }

  function take(suggestion: Suggestion) {
    const active = trigger()
    if (!active) return
    setDismissed(true)
    if (active.kind === "mention") {
      if (suggestion.mention) props.onMention(suggestion.mention)
      replace(active.start, active.end, "")
      return
    }
    replace(active.start, active.end, `/${suggestion.value} `)
  }

  function insertTrigger(symbol: "@" | "/" | "!") {
    if (!editor) return
    setDismissed(false)
    if (symbol === "/" || symbol === "!") {
      if (!props.draft.trim()) replace(0, props.draft.length, symbol)
      else editor.focus()
      return
    }
    const start = editor.selectionStart
    const prefix = start > 0 && /\S/.test(props.draft[start - 1]) ? " " : ""
    replace(start, editor.selectionEnd, prefix + symbol)
  }

  function keyDown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (props.ctx.keybinds.matches("file.attach", event)) {
      event.preventDefault()
      event.stopPropagation()
      if (!props.disabled) picker?.click()
      return
    }
    if (event.key === "Escape" && props.draft.startsWith("!")) {
      event.preventDefault()
      props.onDraft(props.draft.slice(1).trimStart())
      return
    }
    const menu = trigger()
    const options = suggestions()
    if (menu && event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
      return
    }
    if (menu && options.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      const step = event.key === "ArrowDown" ? 1 : -1
      setSelected(index => (index + step + options.length) % options.length)
      queueMicrotask(() => document.getElementById(`${listID()}-${selected()}`)?.scrollIntoView({ block: "nearest" }))
      return
    }
    if (menu && ["Enter", "Tab"].includes(event.key) && !event.shiftKey && options.length) {
      event.preventDefault()
      event.stopPropagation()
      take(options[selected()] ?? options[0])
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      if (!menu || menu.kind === "command") props.onSend()
    }
  }

  function addFiles(files: FileList | null) {
    if (!files?.length || props.disabled) return
    props.onUpload(Array.from(files))
    editor?.focus()
  }

  const listID = () => `${props.editorID}-suggestions`
  const canSend = () => !!(props.draft.trim() || props.mentions.length || props.uploads.length)

  function Attachment(item: { upload: Upload }) {
    const url = item.upload.file.type.startsWith("image/") ? URL.createObjectURL(item.upload.file) : undefined
    onCleanup(() => { if (url) URL.revokeObjectURL(url) })
    return <button type="button" class="oc-side-chip" title={item.upload.file.name}
      aria-label={`Remove attachment ${item.upload.file.name}`} disabled={props.preparing}
      onClick={() => props.onRemoveUpload(item.upload.id)}>
      <Show when={url}><img src={url} alt={item.upload.file.name} /></Show>
      <span>{item.upload.file.name}</span><ui.Icon name="close" size="small" />
    </button>
  }

  return (
    <form class="oc-side-compose" onSubmit={event => { event.preventDefault(); props.onSend() }}>
      <Show when={trigger()}>
        <div class="oc-side-suggestions" id={listID()} role="listbox" aria-label={trigger()?.kind === "mention" ? "Mention context" : "Side chat commands"}>
          <For each={suggestions()} fallback={
            <p role="status">{searching() ? "Searching…" : searchError() ? "Context search failed." : "No matches"}</p>
          }>{(option, index) => <>
            <Show when={option.group && option.group !== suggestions()[index() - 1]?.group}>
              <div class="oc-side-suggestion-group">{option.group}</div>
            </Show>
            <button
              type="button"
              id={`${listID()}-${index()}`}
              role="option"
              aria-selected={index() === selected()}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setSelected(index())}
              onClick={() => take(option)}
            >
              <span>{option.label}</span>
              <Show when={option.description}><small>{option.description}</small></Show>
            </button>
          </>}</For>
        </div>
      </Show>

      <Show when={props.mentions.length || props.uploads.length}>
        <div class="oc-side-chips" aria-label="Draft attachments">
          <For each={props.mentions}>{mention => (
            <button type="button" class="oc-side-chip" title={typeof mention === "string" ? mention : mention.value} aria-label={`Remove mention ${mentionLabel(mention)}`} disabled={props.preparing}
              onClick={() => props.onRemoveMention(mentionKey(mention))}>
              <span>@{mentionLabel(mention)}</span><ui.Icon name="close" size="small" />
            </button>
          )}</For>
          <For each={props.uploads}>{upload => <Attachment upload={upload} />}</For>
        </div>
      </Show>

      <textarea
        id={props.editorID}
        ref={editor}
        role="combobox"
        aria-label="Side chat message"
        aria-autocomplete="list"
        aria-expanded={!!trigger()}
        aria-controls={trigger() ? listID() : undefined}
        aria-activedescendant={suggestions()[selected()] ? `${listID()}-${selected()}` : undefined}
        placeholder={props.draft.startsWith("!") ? "Run a shell command…" : "Ask anything, / for commands, @ for context…"}
        value={props.draft}
        disabled={props.disabled}
        rows={2}
        onFocus={event => { setFocused(true); setCaret(event.currentTarget.selectionStart) }}
        onBlur={() => setFocused(false)}
        onSelect={event => setCaret(event.currentTarget.selectionStart)}
        onInput={event => {
          const input = event.currentTarget
          input.style.height = "auto"
          input.style.height = `${Math.min(input.scrollHeight, 200)}px`
          props.onDraft(input.value)
          setCaret(input.selectionStart)
          setDismissed(false)
        }}
        onKeyDown={keyDown}
        onKeyUp={event => setCaret(event.currentTarget.selectionStart)}
        onDragOver={event => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault() }}
        onDrop={event => {
          if (!event.dataTransfer?.files.length) return
          event.preventDefault()
          event.stopPropagation()
          addFiles(event.dataTransfer.files)
        }}
        onPaste={event => {
          if (!event.clipboardData?.files.length) return
          event.preventDefault()
          addFiles(event.clipboardData.files)
        }}
      />
      <input ref={picker} type="file" multiple hidden onChange={event => {
        addFiles(event.currentTarget.files)
        event.currentTarget.value = ""
      }} />
      <div class="oc-side-toolbar">
        <div class="oc-side-tools">
          <ui.Tooltip value="Add images and files">
            <ui.Menu label="Add images and files" icon="plus" placement="top-start" disabled={props.disabled}
              items={[
                { label: "Add images and files", keys: props.ctx.keybinds.keybind("file.attach"), onSelect: () => picker?.click() },
                { type: "separator" },
                { label: "Commands", keys: ["/"], onSelect: () => queueMicrotask(() => insertTrigger("/")) },
                { label: "Context", keys: ["@"], onSelect: () => queueMicrotask(() => insertTrigger("@")) },
                { label: "Shell", keys: ["!"], disabled: !!props.draft.trim(), onSelect: () => queueMicrotask(() => insertTrigger("!")) },
              ]} />
          </ui.Tooltip>
          <div class="oc-side-model">
            <ui.Button type="button" variant="ghost" size="small" disabled={props.preparing || props.running}
              onClick={props.onModel}>{props.modelLabel}</ui.Button>
          </div>
          <Show when={props.model?.variants.length}>
            <ui.Button type="button" variant="ghost" size="small" disabled={props.preparing || props.running}
              onClick={props.onVariant}>{props.variantLabel}</ui.Button>
          </Show>
        </div>
        <Show when={props.running} fallback={
          <ui.Tooltip value="Send" keys={["Enter"]}>
            <ui.IconButton icon="arrow-up" label="Send side message" variant="neutral" disabled={props.disabled || !canSend()} onClick={props.onSend} class="oc-side-send" />
          </ui.Tooltip>
        }>
          <ui.Tooltip value="Stop side chat and its workers">
            <ui.IconButton icon="stop" label="Stop side response" variant="neutral" disabled={props.preparing} onClick={props.onStop} class="oc-side-send" />
          </ui.Tooltip>
        </Show>
      </div>
    </form>
  )
}
