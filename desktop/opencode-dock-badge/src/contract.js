import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/**
 * Bridge from the app window (which sees events and focus state) to the Electron main
 * process (which alone can call `app.dock.setBadge`).
 */
export const Badge = Ipc.define({
  id: "opencode-dock-badge.badge",
  methods: {
    /** Paint the badge with this count; 0 clears it. */
    set: { input: Schema.Number },
    clear: {},
  },
})
