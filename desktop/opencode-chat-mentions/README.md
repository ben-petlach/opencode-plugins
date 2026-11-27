# Chat Mentions for OpenCode

On OpenCode Desktop 2.3.2, pick a chat from the composer's built-in `@` menu to give the assistant reference context from that chat. This server-only plugin uses the composer's explicit `@session:ses_…` text; bare session IDs and mentions inside other chats are not expanded.

Add this folder's absolute path to the `plugins` array in `~/.config/opencode/opencode.json`, then restart OpenCode Desktop. The checked-in `dist/server.js` is ready to use.

The first five distinct mentioned chats contribute recent transcript excerpts (up to 16,000 characters per chat and 36,000 total). Those excerpts are sent to the current chat's model. They omit raw reasoning and inline attachment data but can still contain sensitive text. Chat history without mentions is unaffected.

The read-only `read_mentioned_chat` tool can page or search the retained transcript of any chat mentioned in a user message, including chats beyond the first five. Searches are case-insensitive and cover visible transcript text and compact tool previews. For pagination, pass `nextOffset` as `offset`, keep `fromEnd` unchanged, and use `nextLimit` if returned. Compaction may have replaced earlier turns with summaries.

To develop with Node 22.18 or later: `npm install`, `npm run check`, `npm test`, `npm run build`.
