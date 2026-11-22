# OpenCode Desktop Side Chat v0.2.10

Built for OpenCode Desktop 2.3.2. This directory includes the built plugin and its source.

1. Clone this repository or extract its ZIP to a permanent folder.
2. Open your global OpenCode config at `~/.config/opencode/opencode.json` or its JSONC equivalent. Add the absolute path to this plugin folder (`desktop/opencode-desktop-side-chat` in a repository clone) to the existing `plugins` array. The path should point to the folder containing `package.json`. Replace any previous Side Chat plugin path with this version so only one copy is configured.
3. Reopen OpenCode Desktop. In an existing chat, type `/sidechat`.

The first side message takes a snapshot of the main chat. Click **Update from main** to refresh that snapshot. Use **Share with agent** to put the side conversation in the main composer for review before sending.

To rebuild from source with Node.js 22, run `npm ci --legacy-peer-deps --ignore-scripts`, `npm run check`, and `npm run build` in this plugin folder. Run the tests with `node --conditions=browser --experimental-strip-types --test test/*.test.ts`.

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
