# OpenCode Desktop plugins

The `desktop/` folder contains MIT-licensed plugins built for OpenCode Desktop 2.3.2.

| Plugin | Version | What it does |
| --- | --- | --- |
| [Follow-up suggestions](desktop/opencode-desktop-followups/) | 0.1.0 | Suggests editable next prompts based on the latest reply. Requires Google Vertex with Gemini 3.1 Flash-Lite configured in OpenCode. |
| [Side Chat](desktop/opencode-desktop-side-chat/) | 0.2.11 | Opens independent chat tabs with context from the main chat. Share a side transcript back to the main composer as an editable draft. Running side chats mark their main chat as working. |

## Install

1. Clone this repository or use **Code → Download ZIP** and extract it to a permanent location. Both plugins include prebuilt bundles.
2. Open `~/.config/opencode/opencode.json`. Add the absolute path to each plugin folder you want to load to the existing `plugins` array. Keep any existing entries and replace older paths for the same plugins.
3. Restart OpenCode Desktop. Use **Suggest next prompts** from the command palette or type `/sidechat` in an existing chat.

An example configuration for both plugins:

```json
{
  "plugins": [
    "/absolute/path/to/opencode-plugins/desktop/opencode-desktop-followups",
    "/absolute/path/to/opencode-plugins/desktop/opencode-desktop-side-chat"
  ]
}
```

Update by pulling the latest changes in your clone, then restart OpenCode Desktop. See each plugin's README for build instructions, compatibility details, and attribution. Both use OpenCode's experimental GUI SDK.
