import type { SessionInfo } from "@opencode/client"
import type { Context, MountedSession } from "@opencode/plugin/gui"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { Worker } from "./timeline"
import { stopSideChat } from "./workers"

export function WorkerCard(props: {
  ctx: Context; session: MountedSession; worker: Worker; workers: readonly SessionInfo[];
  disabled?: boolean;
  modelName: (provider: string, id: string) => string;
}) {
  const ui = props.ctx.ui
  const data = props.session.server.data
  const info = () => data.session.get(props.worker.sessionID)
  const running = () => data.session.status(props.worker.sessionID) === "running"
  const [replying, setReplying] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [busy, setBusy] = createSignal<"sending" | "stopping">()
  const [error, setError] = createSignal<string>()
  async function act(action: "sending" | "stopping") {
    if (busy() || props.disabled) return
    setBusy(action)
    setError(undefined)
    try {
      if (action === "stopping") await stopSideChat(data, props.session.server.client, props.worker.sessionID,
        AbortSignal.any([props.ctx.signal, AbortSignal.timeout(60_000)]))
      else {
        const text = draft().trim()
        if (!text) return
        await data.session.prompt({ sessionID: props.worker.sessionID, text })
        setDraft("")
        setReplying(false)
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(undefined) }
  }
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!running()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const status = () => busy() === "stopping" ? "Stopping…" : data.session.permission.list(props.worker.sessionID)?.length ? "Waiting for permission"
    : data.session.form.list(props.worker.sessionID, info()?.location)?.length ? "Waiting for input"
    : running() ? "Running" : !info() ? "Loading" : info().outcome === "interrupted" ? "Stopped"
    : info().outcome === "failed" ? "Failed" : info().outcome === "succeeded" ? "Finished" : "Idle"
  const elapsed = () => {
    const start = info()?.time.busy
    const end = running() ? now() : info()?.time.idle
    return start !== undefined && end !== undefined && end >= start ? `${Math.floor((end - start) / 1000)}s` : ""
  }
  return <div class="oc-side-worker">
    <ui.Button type="button" variant="ghost" class="oc-side-worker-open"
      onClick={() => props.ctx.tabs.open({ server: props.session.server.id, id: props.worker.sessionID }, { focus: true })}>
      <Show when={running()} fallback={<ui.Icon name="branch" size="small" />}><ui.Loader /></Show>
      <span class="oc-side-worker-body">
        <span class="oc-side-worker-title">{props.worker.description ?? info()?.title ?? "Background worker"}</span>
        <span class="oc-side-worker-meta">{info()?.agent ?? props.worker.agent ?? "Agent"}
          <Show when={info()?.model}>{model => <> · {props.modelName(model().providerID, model().id)}</>}</Show>
          {` · ${status()}${elapsed() ? ` · ${elapsed()}` : ""}`}
        </span>
      </span>
      <ui.Icon name="chevron-right" size="small" />
    </ui.Button>
    <div class="oc-side-worker-actions">
      <ui.Button type="button" variant="ghost" size="small" disabled={!!busy() || props.disabled} onClick={() => setReplying(value => !value)}>Follow up</ui.Button>
      <Show when={running()}><ui.Button type="button" variant="ghost" size="small" disabled={!!busy() || props.disabled}
        onClick={() => void act("stopping")}>Stop worker</ui.Button></Show>
    </div>
    <Show when={replying()}><form class="oc-side-worker-reply" onSubmit={event => { event.preventDefault(); void act("sending") }}>
      <textarea aria-label="Message worker" placeholder="Message this worker…" rows={2} value={draft()}
        disabled={!!busy() || props.disabled} onInput={event => setDraft(event.currentTarget.value)} />
      <ui.Button type="submit" variant="neutral" size="small" disabled={!draft().trim() || !!busy() || props.disabled}>Send to worker</ui.Button>
    </form></Show>
    <Show when={error()}>{message => <p class="oc-side-error" role="alert">{message()}</p>}</Show>
    <For each={props.workers.filter(worker => worker.parentID === props.worker.sessionID)}>{child =>
      <WorkerCard {...props} worker={{ sessionID: child.id, agent: child.agent, description: child.title }} />
    }</For>
  </div>
}
