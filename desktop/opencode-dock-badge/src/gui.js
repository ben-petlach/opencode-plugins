import { Command, Plugin } from "@opencode/plugin/gui"
import { Badge } from "./contract"

export default Plugin.define({
  i18n: {
    en: { "command.clear": "Clear Dock badge" },
    zh: { "command.clear": "清除 Dock 角标" },
  },
  setup(ctx) {
    const COUNTED = new Set(["attention", "unread", "failed"])

    let pending = 0
    const bridge = () => {
      try {
        return ctx.main(Badge)
      } catch {
        return undefined
      }
    }
    const paint = (n) => {
      if (n === pending) return
      pending = n
      void bridge()?.set(n)?.catch(() => {})
    }

    const scan = () => {
      // shortcut: Desktop 2.3.2 exposes these DOM markers; use a session status API when available.
      const inbox = document.querySelector("[data-slot='sidebar-inbox']")
      if (inbox) {
        if (inbox.getAttribute("aria-busy") === "true") return
        paint(inbox.querySelectorAll(
          "[aria-labelledby$='-unread'] [data-slot='sidebar-inbox-item'], " +
          "[aria-labelledby$='-needs'] [data-slot='sidebar-inbox-item']",
        ).length)
        return
      }

      const tabs = document.querySelectorAll("[data-slot='titlebar-tab-item']")
      paint(Array.from(tabs).filter(tab => {
        const status = tab.getAttribute("data-status")
        if (COUNTED.has(status)) return true
        if (status === "muted" || status === "busy" || tab.getAttribute("data-active") !== "true") return false
        if (document.hasFocus() && !document.hidden) return false

        // The selected tab hides its unread dot even when the window is in the background.
        const session = ctx.sessions.current()
        if (!session) return false
        const data = session.server.data.session
        const time = data.get(data.root(session.id))?.time
        return time?.idle !== undefined && time.archived === undefined &&
          (time.viewed === undefined || time.idle > time.viewed)
      }).length)
    }

    scan()
    const timer = setInterval(scan, 1500)
    const clear = () => paint(0)

    ctx.add(Command, () => ({
      id: "clear",
      title: ctx.t("command.clear"),
      run: clear,
    }))

    return () => {
      clearInterval(timer)
      void bridge()?.clear()?.catch(() => {})
    }
  },

  main(ctx) {
    const { app } = require("electron")
    const paint = (n) => {
      if (process.platform !== "darwin") return
      try {
        app.dock?.setBadge(n > 0 ? String(n) : "")
      } catch {}
    }
    ctx.provide(Badge, {
      set: (n) => paint(Number(n) || 0),
      clear: () => paint(0),
    })
    ctx.log.write("info", "opencode-dock-badge 1.0.1 main ready")
    return () => paint(0)
  },
})
