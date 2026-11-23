# OpenCode Desktop plugins

The `desktop/` folder contains MIT-licensed plugins built for OpenCode Desktop 2.3.2.

| Plugin | Version | What it does |
| --- | --- | --- |
| [Follow-up suggestions](desktop/opencode-desktop-followups/) | 0.1.0 | Suggests editable next prompts based on the latest reply. Requires Google Vertex with Gemini 3.1 Flash-Lite configured in OpenCode. |
| [Side Chat](desktop/opencode-desktop-side-chat/) | 0.2.13 | Opens independent chat tabs with context from the main chat. Share a side transcript back to the main composer as an editable draft. Side chats contribute working, unread and activity-time updates to their main chat. |
| [Dock badge](desktop/opencode-dock-badge/) | 1.0.1 | Shows a macOS Dock count for unread chats and chats needing attention in Inbox and tab layouts. |

## Install

1. Clone this repository or use **Code → Download ZIP** and extract it to a permanent location. Each plugin includes a prebuilt bundle.
2. Open `~/.config/opencode/opencode.json`. Add the absolute path to each plugin folder you want to load to the existing `plugins` array. Keep any existing entries and replace older paths for the same plugins.
3. Restart OpenCode Desktop. The Dock badge runs automatically. Use **Suggest next prompts** from the command palette or type `/sidechat` in an existing chat.

Example configuration:

```json
{
  "plugins": [
    "/absolute/path/to/opencode-plugins/desktop/opencode-desktop-followups",
    "/absolute/path/to/opencode-plugins/desktop/opencode-desktop-side-chat",
    "/absolute/path/to/opencode-plugins/desktop/opencode-dock-badge"
  ]
}
```

Update by pulling the latest changes in your clone, then restart OpenCode Desktop. See each plugin's README for build instructions, compatibility details, and attribution. These plugins use OpenCode's experimental GUI SDK.
