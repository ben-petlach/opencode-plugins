import type { Context } from "@opencode/plugin/gui"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { MAX_QUOTE_LENGTH } from "./selection-text"

const controls = 'textarea,input,[contenteditable="true"],button,[role="toolbar"],.oc-side-message-actions'
const margin = 8

function inControl(node: Node) {
  const element = node instanceof Element ? node : node.parentElement
  return !!element?.closest(controls)
}

export function SideSelectionQuote(props: {
  ctx: Context
  container: () => HTMLElement | undefined
  onQuote: (text: string) => void
}) {
  const ui = props.ctx.ui
  const [toolbar, setToolbar] = createSignal<HTMLDivElement>()
  let dismissed = false
  const [selected, setSelected] = createSignal<ReturnType<typeof readSelection>>()
  const [position, setPosition] = createSignal<{ top: number; left: number }>()

  function readSelection() {
    const selection = window.getSelection()
    const container = props.container()
    if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.anchorNode || !selection.focusNode ||
        !container?.contains(selection.anchorNode) || !container.contains(selection.focusNode) ||
        inControl(selection.anchorNode) || inControl(selection.focusNode)) return
    const text = selection.toString()
    if (!text.trim()) return
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    const bounds = container.getBoundingClientRect()
    if ((!rect.width && !rect.height) || rect.bottom <= bounds.top || rect.top >= bounds.bottom) return
    return { text, rect, bounds }
  }

  function syncSelection() {
    setSelected(dismissed ? undefined : readSelection())
  }

  onMount(() => {
    const container = props.container()
    const selectionChanged = () => {
      dismissed = false
      syncSelection()
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected()) {
        dismissed = true
        setSelected(undefined)
      }
    }
    document.addEventListener("selectionchange", selectionChanged)
    document.addEventListener("mouseup", syncSelection)
    document.addEventListener("keyup", syncSelection)
    document.addEventListener("keydown", keyDown)
    window.addEventListener("resize", syncSelection)
    container?.addEventListener("scroll", syncSelection)
    syncSelection()
    onCleanup(() => {
      document.removeEventListener("selectionchange", selectionChanged)
      document.removeEventListener("mouseup", syncSelection)
      document.removeEventListener("keyup", syncSelection)
      document.removeEventListener("keydown", keyDown)
      window.removeEventListener("resize", syncSelection)
      container?.removeEventListener("scroll", syncSelection)
    })
  })

  createEffect(() => {
    const current = selected()
    const element = toolbar()
    if (!current || !element) {
      setPosition(undefined)
      return
    }
    const { rect, bounds } = current
    const width = element.offsetWidth
    const height = element.offsetHeight
    const minLeft = Math.max(bounds.left, 0) + margin
    const maxLeft = Math.min(bounds.right, window.innerWidth) - width - margin
    const minTop = Math.max(bounds.top, 0) + margin
    const maxTop = Math.min(bounds.bottom, window.innerHeight) - height - margin
    const above = rect.top - height - margin
    setPosition({
      left: Math.max(minLeft, Math.min(rect.left + (rect.width - width) / 2, Math.max(minLeft, maxLeft))),
      top: Math.max(minTop, Math.min(above >= minTop ? above : rect.bottom + margin, Math.max(minTop, maxTop))),
    })
  })

  function handleQuote() {
    const current = readSelection()
    if (!current) return
    if (current.text.length > MAX_QUOTE_LENGTH) {
      props.ctx.toast.show({ title: "Selection too long", description: "Select up to 20,000 characters.", variant: "error" })
      return
    }
    props.onQuote(current.text)
    window.getSelection()?.removeAllRanges()
    setSelected(undefined)
  }

  return <Show when={selected()}>{value => {
    const tooLong = () => value().text.length > MAX_QUOTE_LENGTH
    return (
      <div
        ref={element => { setToolbar(element); onCleanup(() => setToolbar(undefined)) }}
        class="oc-side-quote-toolbar"
        data-sidechat-quote-toolbar=""
        role="toolbar"
        aria-label="Quote selection"
        style={{ top: `${position()?.top ?? 0}px`, left: `${position()?.left ?? 0}px`, visibility: position() ? undefined : "hidden" }}
        onMouseDown={event => event.preventDefault()}
      >
        <ui.Tooltip value={tooLong() ? "Selection too long (max 20,000 characters)" : "Quote in side chat"}>
          <ui.Button type="button" size="small" variant="ghost" icon="outline-quote" disabled={tooLong()} onClick={handleQuote}>
            Quote
          </ui.Button>
        </ui.Tooltip>
      </div>
    )
  }}</Show>
}
