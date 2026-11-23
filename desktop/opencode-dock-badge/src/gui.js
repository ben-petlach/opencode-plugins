import { Command, Plugin, TitlebarItem } from "@opencode/plugin/gui"
import { Badge } from "./contract"

export default Plugin.define({
  i18n: {
    en: { "pill.pending": "needs you", "command.clear": "Clear Dock badge" },
    zh: { "pill.pending": "待处理", "command.clear": "清除 Dock 角标" },
  },
  setup(ctx) {
    const COUNTED = new Set(["attention", "unread"])

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

      const tabs = document.querySelectorAll("[data-slot='titlebar-tab-item'][data-status]")
      paint(Array.from(tabs).filter(tab => COUNTED.has(tab.getAttribute("data-status"))).length)
    }

    scan()
    const timer = setInterval(scan, 1500)
    const clear = () => paint(0)

    ctx.add(TitlebarItem, () =>
      pending > 0
        ? {
            id: "pending",
            label: `${pending} ${ctx.t("pill.pending")}`,
            icon: "notifications",
            title: ctx.t("pill.pending"),
          }
        : undefined,
    )
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
