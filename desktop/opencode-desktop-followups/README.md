# OpenCode Desktop follow-up suggestions

Standalone local GUI plugin for OpenCode Desktop 2.3.2. Adapted from OpenCode PR #57137, with the public experimental GUI SDK instead of patches to the app.

After a successful turn in the routed session, the plugin makes one extra generation request and caches up to three replies. **Suggested next prompts** opens the menu. A clearly likely reply also appears as its own pill and leads the menu. Click a suggestion in an empty prompt or use **Tab** in the focused empty prompt to insert the primary. Sending is separate.

- Keeps the official app and normal updater unchanged.
- Uses `google-vertex/gemini-3.1-flash-lite#minimal` for suggestions, independently of the main chat model. There is no fallback to the main chat model.
- Uses the latest substantive user message for goal and writing style. Reads the latest assistant reply (up to 6,000 characters, preserving its opening and ending) and up to four earlier excerpts. Tool output and reasoning are excluded.
- Concrete proposals get acceptance and decline or deferral. A genuine decision can show its options in the menu without a primary.
- While typing, suggestions filter by case-insensitive prefix and reappear when the draft matches again. OpenCode Desktop 2.3.2 does not expose the caret or selection through its public composer API, so compatible suggestions remain previews until the prompt is empty. Dismissal lasts for the turn unless manually regenerated.
- Provider failures and timeouts leave the composer working normally.
- Command palette: **Suggest next prompts** (also `/suggest-next`), **Disable next-prompt suggestions** / **Enable next-prompt suggestions**.
- Additional model usage may apply. The prediction request uses your existing Google Vertex provider.

## Local installation

Get the prebuilt plugin from this repository. Add its absolute folder path to the existing `plugins` array in `~/.config/opencode/opencode.json`:

```json
{
  "plugins": ["/absolute/path/to/opencode-plugins/desktop/opencode-desktop-followups"]
}
```

OpenCode discovers the package's `./gui-experimental` export; there is no server plugin and no app binary modification. Check Preferences > Extensions > Plugins for `opencode-desktop-followups`. Reload there after rebuilding, or reopen the app.

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

SDK pinned to 2.3.2; lockfile included. The GUI SDK and generation endpoint are experimental, so new OpenCode versions may require a plugin rebuild or API adjustment. This does not require disabling OpenCode updates.

To uninstall, remove this package path from `plugins` in the global configuration, then restart OpenCode Desktop.

## Attribution

See NOTICE and LICENSE. Original PR: https://github.com/anomalyco/opencode/pull/57137
