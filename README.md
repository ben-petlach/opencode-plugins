# OpenCode Desktop plugins

The `desktop/` folder contains MIT-licensed plugins built for OpenCode Desktop 2.3.2.

| Plugin | Version | What it does |
| --- | --- | --- |
| [Follow-up suggestions](desktop/opencode-desktop-followups/) | 0.1.1 | Suggests editable next prompts based on the latest reply in both main chat and Side Chat. Requires Google Vertex with Gemini 3.1 Flash-Lite configured in OpenCode. |
| [Side Chat](desktop/opencode-desktop-side-chat/) | 0.2.16 | Opens auto-named independent chat tabs with working/unread indicators, select-to-quote, follow-up prompt suggestions, live main-chat and sub-agent inspection, and explicit sharing back to the main composer. |
| [Dock badge](desktop/opencode-dock-badge/) | 1.0.1 | Shows a macOS Dock count for unread chats and chats needing attention in Inbox and tab layouts. |
| [Chat Mentions](desktop/opencode-chat-mentions/) | 0.1.0 | Gives the assistant reference context from chats explicitly `@`-mentioned in the composer, with a read-only search and paging tool. |

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
    "/absolute/path/to/opencode-plugins/desktop/opencode-dock-badge",
    "/absolute/path/to/opencode-plugins/desktop/opencode-chat-mentions"
  ]
}
```

Update by pulling the latest changes in your clone, then restart OpenCode Desktop. See each plugin's README for build instructions, compatibility details, and attribution. Plugins with a desktop UI use OpenCode's experimental GUI SDK; Chat Mentions is server-only.
