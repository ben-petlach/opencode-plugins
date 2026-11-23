# OpenCode Dock Badge

In OpenCode Desktop on macOS, the Dock badge counts sessions in Inbox’s **Unread** and **Needs attention** sections. In tab layouts, it counts tabs marked unread or needing attention. OpenCode determines when a session is read.

This local fork comes from the published [opencode-dock-badge 1.0.0 package](https://www.npmjs.com/package/opencode-dock-badge/v/1.0.0), authored by wuwu and published under the MIT license.

Add this directory’s absolute path to the `plugins` array in OpenCode’s `opencode.json`. To rebuild the bundled GUI, run `npm ci` and `npm run build`.

The plugin reads the DOM markers shipped with OpenCode Desktop 2.3.2. Check compatibility after an OpenCode upgrade.
