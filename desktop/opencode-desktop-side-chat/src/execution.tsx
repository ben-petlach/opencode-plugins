import type { Context } from "@opencode/plugin/gui"
import { For, Show } from "solid-js"
import { executionLabel, executing, type Execution } from "./timeline"

export function ExecutionGroup(props: { ctx: Context; entries: readonly Execution[] }) {
  const ui = props.ctx.ui
  const entry = (id: string) => props.entries.find(item => item.id === id)!
  return <details class="oc-side-executions">
    <summary><Show when={executing(props.entries)}><ui.Loader /></Show>
      {executing(props.entries) ? "Using" : "Used"} {executionLabel(props.entries)}
      <Show when={executing(props.entries)}><span class="oc-side-execution-live">{props.entries.find(item => ["running", "streaming", "pending"].includes(item.status))?.label}</span></Show>
    </summary>
    <div class="oc-side-execution-list"><For each={props.entries.map(item => item.id)}>{id =>
      <details class="oc-side-execution">
        <summary>{entry(id).label}<span>{entry(id).status}</span></summary>
        <Show when={entry(id).input}><details class="oc-side-execution-data"><summary>Input</summary><pre>{entry(id).input}</pre></details></Show>
        <Show when={entry(id).output}><details class="oc-side-execution-data"><summary>Output · {entry(id).output!.split("\n").length} lines</summary>
          <pre>{entry(id).output}</pre></details></Show>
        <Show when={entry(id).error}><p role="alert">{entry(id).error}</p></Show>
      </details>
    }</For></div>
  </details>
}
