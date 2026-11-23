import type { Context } from "@opencode/plugin/gui"
import type { SessionMessageInfo } from "@opencode/client"
import { createSignal, For, Index, Show } from "solid-js"
import type { Line } from "./conversation"
import { duration, tokensPerSecond } from "./session-turn"

export function SideMessage(props: {
  ctx: Context
  line: Line
  messages: readonly SessionMessageInfo[]
  modelName: (provider: string, id: string) => string
  quote: (text: string) => void
}) {
  let article: HTMLElement | undefined
  const ui = props.ctx.ui
  const [copied, setCopied] = createSignal(false)
  const message = () => props.line.message
  const userFiles = () => { const value = message(); return value?.type === "user" ? value.files ?? [] : [] }
  const assistant = () => { const value = message(); return value?.type === "assistant" ? value : undefined }
  const label = () => {
    const value = assistant()
    return value ? [value.agent, props.modelName(value.model.providerID, value.model.id), value.model.variant].filter(Boolean).join(" · ") : ""
  }
  const elapsed = () => {
    const value = assistant()
    return value?.time.completed === undefined ? undefined : duration(props.messages, value)
  }
  const speed = () => { const value = assistant(); return value ? tokensPerSecond(props.messages, value) : undefined }
  async function copy() {
    try {
      await props.ctx.system.copy(props.line.text)
      setCopied(true)
    } catch {
      props.ctx.toast.show({ title: "Couldn’t copy message", variant: "error" })
    }
  }
  function details() {
    const value = message()
    const rows: [string, string][] = [["Message", props.line.message?.id ?? props.line.id]]
    if (value) rows.push(["Sent", new Date(value.time.created).toLocaleString()])
    const reply = assistant()
    if (reply) {
      rows.push(["Model", `${reply.model.providerID}/${reply.model.id}`], ["Reasoning level", reply.model.variant ?? "Default"], ["Agent", reply.agent])
      if (elapsed() !== undefined) rows.push(["Duration", `${(elapsed()! / 1000).toFixed(1)} s`])
      if (speed() !== undefined) rows.push(["Tokens per second", speed()!.toFixed(1)])
      if (reply.tokens) rows.push(...Object.entries({ Input: reply.tokens.input, Output: reply.tokens.output,
        Reasoning: reply.tokens.reasoning, "Cache read": reply.tokens.cache.read, "Cache write": reply.tokens.cache.write })
        .map(([name, count]): [string, string] => [name + " tokens", count.toLocaleString()]))
      if (reply.cost !== undefined) rows.push(["Cost", `$${reply.cost.toFixed(5)}`])
      if (reply.finish) rows.push(["Finish reason", reply.finish])
    }
    props.ctx.dialogs.open(() => <ui.Dialog title="Message details"><dl class="oc-side-details">
      <For each={rows}>{row => <><dt>{row[0]}</dt><dd>{row[1]}</dd></>}</For>
      <Show when={!value}><dt>Metrics</dt><dd>Unavailable for legacy messages</dd></Show>
    </dl></ui.Dialog>)
  }
  function quote() {
    const selection = window.getSelection()
    const text = selection?.anchorNode && selection.focusNode && article?.contains(selection.anchorNode) && article.contains(selection.focusNode)
      ? selection.toString() : ""
    props.quote(text.trim() ? text : props.line.text)
  }
  return <article ref={article} class={`oc-side-message oc-side-message-${props.line.role}`} aria-label={props.line.role === "user" ? "Your message" : "Assistant response"}>
    <Show when={userFiles().some(file => file.mime.startsWith("image/"))}>
      <div class="oc-side-images"><For each={userFiles().filter(file => file.mime.startsWith("image/"))}>{file =>
        <img alt={file.name ?? "Attached image"} src={file.data.startsWith("data:") ? file.data : `data:${file.mime};base64,${file.data}`} />
      }</For></div>
    </Show>
    <Show when={props.line.files?.length}>
      <div class="oc-side-chips"><For each={props.line.files}>{name => <span class="oc-side-chip"><ui.Icon name="file-document" size="small" /><span>{name}</span></span>}</For></div>
    </Show>
    <Show when={props.line.role === "user"} fallback={
      <Show when={assistant()} fallback={message()?.type === "shell" ? <pre class="oc-side-shell">{props.line.text}</pre> : <ui.Markdown text={props.line.text} />}>{reply => <>
        {/* Polling replaces content objects; keep Markdown mounted by position. */}
        <Index each={reply().content}>{part => <>
          <Show when={part().type === "text" ? part() as Extract<ReturnType<typeof part>, { type: "text" }> : undefined}>{text => <ui.Markdown text={text().text} />}</Show>
          <Show when={part().type === "reasoning" ? part() as Extract<ReturnType<typeof part>, { type: "reasoning" }> : undefined}>{reasoning => <details class="oc-side-disclosure"><summary>Thinking</summary>
            <ui.Markdown text={reasoning().text} /></details>}</Show>
          <Show when={part().type === "tool" ? part() as Extract<ReturnType<typeof part>, { type: "tool" }> : undefined}>{tool => {
            return <Show when={tool().state} keyed>{state => <details class="oc-side-disclosure"><summary>{tool().name} · {state.status}</summary>
              <Show when={"input" in state}><pre>{"input" in state ? JSON.stringify(state.input, null, 2) : ""}</pre></Show>
              <Show when={"content" in state}><For each={"content" in state ? state.content : []}>{item =>
                item.type === "text" ? <pre>{item.text}</pre> : <p>{item.name ?? item.mime}</p>}</For></Show>
              <Show when={state.status === "error"}><p role="alert">{state.status === "error" ? state.error.message : ""}</p></Show>
            </details>}</Show>
          }}</Show>
        </>}</Index>
      </>}</Show>
    }><div class="oc-side-prompt">{props.line.text}</div></Show>
    <footer class="oc-side-message-actions">
      <ui.Tooltip value={copied() ? "Copied" : props.line.role === "user" ? "Copy message" : "Copy response"}>
        <ui.IconButton icon={copied() ? "check" : "copy"} label={props.line.role === "user" ? "Copy message" : "Copy response"} size="small" disabled={!props.line.text} onClick={() => void copy()} />
      </ui.Tooltip>
      <span class="oc-side-meta">{label()}<Show when={elapsed() !== undefined}> · {Math.round(elapsed()! / 1000)}s</Show>
        <Show when={speed() !== undefined}> · {speed()!.toFixed(1)} tok/s</Show></span>
      <ui.Menu label="More actions" placement="top-end" items={[
        { label: props.line.role === "user" ? "Copy message" : "Copy response", icon: "copy", disabled: !props.line.text, onSelect: () => void copy() },
        { label: "Quote in side chat", icon: "outline-quote", disabled: !props.line.text, onSelect: quote },
        { type: "separator" },
        { label: "Message details", icon: "info", onSelect: details },
      ]} />
    </footer>
  </article>
}
