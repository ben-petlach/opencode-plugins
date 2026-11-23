# OpenCode Desktop Side Chat v0.2.16

Built for OpenCode Desktop 2.3.2. This directory includes the built plugin and its source.

1. Clone this repository or extract its ZIP to a permanent folder.
2. Open your global OpenCode config at `~/.config/opencode/opencode.json` or its JSONC equivalent. Add the absolute path to this plugin folder (`desktop/opencode-desktop-side-chat` in a repository clone) to the existing `plugins` array. The path should point to the folder containing `package.json`. Replace any previous Side Chat plugin path with this version so only one copy is configured.
3. Reopen OpenCode Desktop. In an existing chat, type `/sidechat`.

The first side message takes a snapshot of the main chat. Click **Update from main** to refresh that snapshot. Use **Share with agent** to put the side conversation in the main composer for review before sending.

To rebuild from source with Node.js 22, run `npm ci --legacy-peer-deps --ignore-scripts`, `npm run check`, and `npm run build` in this plugin folder. Run the tests with `node --conditions=browser --experimental-strip-types --test test/*.test.ts`.

## v0.2.16

- With the compatible OpenCode Desktop Follow-ups plugin enabled, Side Chat suggests next prompts. Use `/suggest-next` to regenerate or the accept shortcut to insert a suggestion into an empty draft without sending it.
- Select text in a side transcript and choose **Quote** to append it to that side chat’s draft.
- Each side tab shows a spinner while it or a worker is running, then an unread dot if its response finished out of view. Opening the main chat does not clear that dot.
- Side chats use concise titles from their first request, preferring OpenCode’s native title and falling back to a generated title when needed.

## Local model-picker update

The side-chat model picker reads the main chat’s saved visibility, favorites, and recent models each time it opens. Selection still changes only the side chat. This uses a read-only connection to OpenCode Desktop 2.3.2’s preferences database because the GUI SDK has no model-preference API; a future storage change may require updating this adapter.

Checks: `npm run check`, `npm run build`, and `node --experimental-strip-types --test test/models.test.ts`.

## Local chat UI update

Uses OpenCode’s GUI SDK menus, icon buttons, tooltips, Markdown and dialogs. The composer’s + menu follows the main editor’s attachment / commands / context / shell menu. Sent text is selectable; both roles offer copy, quote and message details. The transcript retains thinking and tool records. The response footer uses upstream turn-duration and provider-active token-rate calculations; historical messages without measurements do not show a rate. Snapshot updates, explicit sharing, and separate model choices remain available.

OpenCode does not export its complete editor or timeline through the plugin SDK; those layouts are adapted locally. Upstream source attribution is in NOTICE.

## v0.2.5

- Consecutive tool calls and thinking share compact collapsed execution groups. Expand a group, a call, then its input/output. Streaming updates preserve the open state.
- Opening/selecting Side Chat focuses its composer. Removed the empty-chat instruction.
- New side sessions use Build. Existing Plan side sessions switch to Build on their next submission, preserving history. Other explicitly selected agents remain unchanged.
- A successful Update from main adds a persistent timestamped transcript divider at the exact message boundary. Failed updates add no divider.
- Compact native refresh/share icon buttons provide tooltips, loading feedback, and success checkmarks.

Validation: 12 automated tests, TypeScript check and production build passed. Tested in a separate OpenCode Desktop 2.3.2 instance with its own profile, config, database and server port; verified execution calls, expansion, Build creation/migration, autofocus, parent sharing, and divider persistence across close/reopen and full reload.

## v0.2.6: multiple side chats

- `/sidechat` opens your last selected side chat for the current main chat.
- Use **New side chat** (header +, the side panel’s + menu, command palette, or `/sidechat-new`) to create another independent tab.
- **Side chats** in the header lists all of this main chat’s conversations, including closed tabs. Closing a tab keeps its history; choose it from this menu to reopen it.
- Each tab has its own session, draft, attachments, model/variant, context snapshot and context-update markers. Update/share/Stop affect only the selected side chat.
- Existing conversations appear as **Side chat 1** and continue using their original storage and server session. No history is copied or deleted.
- Tabs, closed conversations and drafts survive desktop reloads. Initial context is captured from the parent when a tab sends its first message; later refreshes are explicit and scoped to that tab.

QA: tested three tabs in an isolated OpenCode Desktop instance. Verified different models, independent prompts/replies and parent-only context via the server API; background completion after tab switches; close/reopen and full reload persistence; independent context-update markers and sharing; and isolation between two different main chats. Original active desktop/config was not changed. The 12 existing automated regression tests, typecheck and production build pass.

## v0.2.7: Ask in Side Chat

Select text in the main conversation and choose **Ask in Side Chat** beside the native **Quote** button. It opens a new side-chat tab with the selected text as an editable blockquote, focuses the composer, and sends nothing. Existing drafts and the native Quote action remain unchanged.

Shortcut fallback: **Cmd+Option+S** on macOS, **Ctrl+Alt+S** elsewhere. Change it under OpenCode Settings > Shortcuts > Ask in Side Chat. Select main-chat text first; selections in editors or other side chats do not trigger it. Selections above OpenCode’s 20,000-character quote limit are rejected rather than truncated.

The toolbar adapter targets OpenCode Desktop 2.3.2’s internal selection toolbar because the GUI SDK has no public selection-toolbar slot. Future OpenCode UI changes may require updating the adapter; the keyboard command is registered independently.

Validation: 15 automated tests, TypeScript check and build pass. In an isolated desktop profile verified native Quote, the added button, new-tab creation, exact quoted draft/focus, no automatic send, existing-draft preservation, no-selection shortcut behavior, and the keyboard fallback with the toolbar adapter deliberately disabled in a QA-only fixture.

## v0.2.8: Share to editable main draft

**Share with agent** now inserts only the selected side chat’s transcript into the main textbox and focuses it so you can add your thoughts before sending. It preserves existing draft text, mentions and attachments through the native composer insertion API. It does not send a message, enqueue context, or resume the main agent. In shell mode the action is disabled; if you switch main chats during the transcript fetch, insertion is cancelled.

Validated in an isolated desktop instance with an existing main draft and a separate side-chat draft. Verified the main draft stayed editable, the original text remained, and the parent’s transcript and pending inbox did not change after Share. All 15 existing regression tests, typecheck and build pass.


## v0.2.9: stable transcript scrolling

Polling now updates assistant content in place instead of remounting Markdown every 500 ms. This prevents earlier replies from briefly collapsing and resetting the transcript to the top. New output follows the bottom while you are near it; scrolling up pauses following until you return to the bottom or send another prompt. Following uses actual content size, including asynchronously rendered Markdown. Submission requests following once at the start, so a long-running shell request cannot override a later manual scroll when it finishes.

Validation: typecheck, production build, and all 15 automated regression tests pass. In an isolated OpenCode Desktop 2.3.2 profile, reproduced the original repeated top reset on v0.2.8, then checked the fix with long replies, repeated polling, manual scrolling, new submissions, and shell execution.


## v0.2.10: parent chat working status

A running side chat now contributes to its main chat's native working indicator in the tab strip, session lists and working views. It keeps working when another side chat or the main chat is still running, including when the side tab is closed or another main chat is selected. Existing side-chat sessions work without recreating them.

The adapter uses the saved `desktopSideChatParent` metadata in the client's root lookup. It does not rewrite server parent links, transcripts, contexts, costs or execution status, and does not add side chats to the native subagent controls. The original lookup is restored on plugin unload. This is a compatibility adapter for OpenCode Desktop 2.3.2; a future activity-provider API should replace it.

Validation: typecheck, production build and all 19 tests pass, including four tests against OpenCode's actual Solid data store for concurrent runs, separate parents, refreshes, descendants, invalid links and cleanup. Tested in a separate desktop profile: the parent activity ring appeared for an existing side chat, stayed active after closing its tab and switching main chats, and cleared after completion. The main draft remained editable.


## v0.2.11: native mention sources

The `@` picker now includes the main composer's skills, non-primary visible agents, references and recent root chats alongside files and folders. It uses the same location-scoped SDK sources, hidden-item rules, context group order and fuzzysort 3.1.0 label ranking. Grouped results have compact descriptions and keyboard selection scrolls into view.

Selections remain draft chips until you send. Skills and agents use the native request fields, references use their actual paths and display names, and chat mentions use stable `@session:` tokens. Mention spans refer to the exact sent text. These fields also work with session slash commands. Older string-based file mentions remain readable, and selected context survives closing/reopening side tabs.

Validation: all 23 automated tests, typecheck and production build pass. In a separate desktop profile, compared all 15 Slack skill entries and their order with the native main picker, selected Slack without sending, reopened the saved draft, then verified the submitted message contained the real `slack--slack` skill and its mention span. The isolated test returned `MENTION_QA` without tool calls. No Slack messages were sent.


## v0.2.12: completed activity and unread state

Side-chat completions now update the parent's native unread state and last-activity time. While any main/side run is active, the Working card uses the earliest current run's start for its elapsed timer; completing one side chat does not reset a still-running sibling's timer. The latest completed run supplies the parent's displayed result and completion time.

Opening the parent or using native Mark read acknowledges the completed sessions through OpenCode's `session.view` API with each session's actual observed idle timestamp. A newer completion stays unread if it arrives during that request. The viewed state persists on the side sessions, and archived side-chat metadata loads on connection so closed tabs retain unread state and recency after restart. No synthetic parent execution or transcript message is created, and costs and real parent links remain independent.

Compatibility: the Desktop 2.3.2 adapter covers native session-summary/index reads and the viewed API, restoring them on unload. Only viewed watermarks are written to the server.

Validation: all 28 automated tests pass, including nine activity/read-state tests against OpenCode's real Solid data store. Typecheck and production build pass. In an isolated Desktop 2.3.2 instance using Inbox layout, verified a live 5-second Working timer, background completion moving the parent to Unread with a fresh activity time, unread surviving a full app restart, and opening the parent moving it to Recent while persisting the side session's viewed timestamp. API checks confirmed the main session's actual busy/idle times and transcript were not used to fabricate an execution.


## v0.2.13: main-chat and sub-agent tool context

Side Chat’s initial main-chat snapshot and **Update from main** now include ordinary tool-call records in message order: tool name, call ID, status, inputs, text outputs and errors. Tool-only assistant messages are included. Standalone shell output, user attachments, completed compaction summaries and legacy side-chat history remain available. Tool results are identified as background data, not user instructions.

Snapshots also fetch native child sessions recursively, including active and archived descendants. Each child record identifies its originating agent, task title, session and parent. Running agents contribute records available when captured. Side Chat sessions are excluded. Capture is capped at 24 descendants with an explicit omission notice; a failed context request surfaces an error rather than silently claiming complete coverage. Existing snapshots remain unchanged until a successful refresh.

Tool inputs are limited to 2,000 characters, outputs to 4,000 per call, and errors to 1,000. Large fields retain their beginning and end with explicit truncation markers. File outputs include names, MIME types and references; inline data/blob payloads are omitted. Main and descendant records share the existing 30,000-character content budget and favor recent records. This remains an explicit snapshot, with no automatic live synchronization. Visible transcripts and sharing behavior are unchanged.

Validation: all 36 automated tests pass, plus TypeScript check and production build. In a separate Desktop 2.3.2 profile, executed two real main-chat shell tool calls. Verified initial capture included actual output, later main activity left that snapshot unchanged, and **Update from main** captured both calls with an inline marker. Also executed real child and nested-child shell calls, and verified capture included both outputs, origin labels and a real delegation error. QA’s subagent depth setting was raised only in the isolated profile; the active installation’s settings were preserved. Automated tests cover pagination, archived children, repeated/cyclic links, descendant limits, error propagation, running/streaming records, file outputs and truncation.

## v0.2.14: live main-chat inspection

Side Chat can now query the linked main chat and its active or archived nested sub-agents on demand, including activity after the snapshot. These read-only tools are available only inside Side Chat and cannot read sibling side chats or unrelated sessions:

- `main_chat_list_sessions` discovers sessions and their activity, tool counts and compaction flags.
- `main_chat_list_tool_calls` lists chronological tool calls with filters and previews.
- `main_chat_read_tool_call` reads retained input, output, or error by call ID, with character pagination and file references. `main_chat_search` searches full retained records and returns offsets you can use to jump to a match.
- `main_chat_read_messages` pages through live messages, starting with the newest page by default.

The initial and refreshed snapshots now show compact tool previews and reserve most of the budget for the main chat. Inline data/blob payloads are omitted. Broad live queries scan up to 200 sessions and flag omitted descendants; a known session ID can be checked directly. OpenCode compaction can summarize earlier raw calls, and the tools can only return data available in OpenCode’s current session context. Excerpts and tool results are untrusted background data, not instructions.

Validation: all 46 automated tests, TypeScript check, both production bundles (`dist/gui-experimental.cjs` and `dist/server.js`), and host entrypoint resolution (`id: opencode-desktop-side-chat`) pass. Verified live in an isolated OpenCode Desktop 2.3.2 instance: confirmed both server and GUI features active, confirmed `main_chat_*` tools are hidden from the main chat, and confirmed Side Chat automatically called all five inspection tools (`main_chat_list_sessions`, `main_chat_list_tool_calls`, `main_chat_read_tool_call`, `main_chat_search`, and `main_chat_read_messages`) to retrieve dynamic runtime hashes from the middle of a >19,000-character main-chat shell output, a direct sub-agent, a nested sub-agent, and a new main-chat tool call run after the snapshot without clicking **Update from main**. QA’s subagent depth setting was raised only temporarily in the isolated profile and restored afterward; active settings were preserved.


## v0.2.15: visible workers and reliable interruption

Side Chat renders native-style cards for delegated workers, with their task, agent/model, live state and elapsed time. Cards remain visible after the side agent finishes speaking; repeated delegation to the same child updates one card. Native descendants appear beneath their parent, including workers that inherit Side Chat metadata. A persistent active-worker count keeps background activity discoverable. Waiting-for-permission and waiting-for-input states open the worker’s native session, where OpenCode renders its tools, screenshots when available, and requests.

Click a card to open the native worker transcript. **Back to Side Chat** in the native session header returns to the original main chat and its saved side panel. Desktop 2.3.2’s native sub-agent view is read-only, so cards provide compact **Follow up** and **Stop worker** controls. Follow-ups target the existing worker session. Side-chat drafts and history remain independent. This does not add continuous computer-screen video.

**Stop side response** stops the selected side chat and its native descendants. It shows Stopping while cancellation settles, stops descendants before their ancestors can resume from completion reports, waits for OpenCode’s actual idle confirmation, and refreshes session, pending-input, permission and form state. It reconciles activity with the server without overwriting newer execution events. Other side tabs and the main run are outside this operation. Interrupted tool/thinking disclosures no longer retain a permanent running spinner. Reload also discovers saved workers and repairs stale client activity from the server snapshot.

Validation: all 53 automated tests pass, plus TypeScript check and GUI/server production builds. In an isolated Desktop 2.3.2 instance, verified a real background worker card/timer after its side agent finished; native worker and nested-worker navigation; Back to Side Chat preserving an unsent draft; direct follow-up reaching the same worker; nested cards; a waiting-permission badge opening OpenCode’s native approval controls; whole-chat Stop settling both side and worker; worker-only Stop clearing pending approvals; and side-only interruption leaving another side’s worker active. Server API checks confirmed interrupted runs were actually inactive. Renderer reload preserved tabs, draft, nested cards and stopped states without a Working entry. Automated tests also cover stale activity recovery on reload, inherited Side Chat metadata, cancellation ordering, failed-stop visibility and newer execution events winning over stale snapshots.
