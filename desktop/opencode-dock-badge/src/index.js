/**
 * opencode-dock-badge — server part.
 *
 * Deliberately minimal: the desktop GUI half already subscribes to the full event
 * stream and owns the Dock badge. This export exists only so the package has a
 * normal plugin id and can be listed / toggled like any other plugin.
 */
export default {
  id: "opencode-dock-badge",
  setup: async () => {},
}
