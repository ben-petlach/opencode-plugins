import { Plugin } from "@opencode/plugin"
import { mentionedSessionIDs } from "./mentions.ts"
import { type Chat, type PageOptions, formatMentionedChats, readChatPage } from "./transcript.ts"

const toolName = "read_mentioned_chat"
const injectedLimit = 5

function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > limit) cache.delete(cache.keys().next().value!)
}

export default Plugin.define({
  id: "opencode-chat-mentions",
  async setup(ctx) {
    const authorized = new Map<string, Set<string>>()
    const chats = new Map<string, Chat["messages"]>()

    async function loadChat(sessionID: string, signal?: AbortSignal): Promise<Chat> {
      const session = await ctx.session.get({ sessionID }, { signal })
      const key = `${sessionID}:${session.time.updated}`
      const messages = chats.get(key) ?? await ctx.session.context({ sessionID }, { signal })
      remember(chats, key, messages, 16)
      return { session, messages }
    }

    const tool = await ctx.tool.transform(editor => {
      editor.add({
        name: toolName,
        description: "Read a chat explicitly @-mentioned by the user. Searches the retained transcript with a case-insensitive substring. With no query or offset, returns the newest turns. To continue, pass nextOffset as offset, keep fromEnd unchanged, and use nextLimit if provided.",
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            sessionID: { type: "string", minLength: 1, description: "ID of a chat explicitly @-mentioned in this conversation." },
            query: { type: "string", minLength: 1, description: "Case-insensitive substring filter." },
            offset: { type: "integer", minimum: 0, description: "Starting turn index in chronological order (zero-based, before filtering)." },
            limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum turns to return (default: 20)." },
            fromEnd: { type: "boolean", description: "Page toward older turns, returning each page chronologically. Defaults to true only when no offset or query is supplied." },
            includeToolSummaries: { type: "boolean", description: "Include compact tool summaries (default: true)." },
          },
          required: ["sessionID"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const { sessionID, ...page } = input as PageOptions & { sessionID: string }
          const signal = context.signal
          signal?.throwIfAborted()
          const error = (message: string) => ({ content: JSON.stringify({ error: message }) })
          let ids = authorized.get(context.sessionID)
          if (!ids) {
            try {
              const messages = await ctx.session.context({ sessionID: context.sessionID }, { signal })
              // An in-flight context hook may already have supplied the active request's authorization.
              ids = authorized.get(context.sessionID) ?? mentionedSessionIDs(messages, context.sessionID)
              remember(authorized, context.sessionID, ids, 500)
            } catch {
              signal?.throwIfAborted()
              return error("Could not verify the current chat's explicit @mentions.")
            }
          }
          if (!ids.has(sessionID)) {
            return error("That session was not explicitly @-mentioned by the user in this conversation.")
          }
          try {
            return { content: JSON.stringify(readChatPage(await loadChat(sessionID, signal), page)) }
          } catch {
            signal?.throwIfAborted()
            return error(`Could not load mentioned chat ${sessionID}.`)
          }
        },
      })
    })

    try {
      const hook = await ctx.session.hook("context", async event => {
        const ids = mentionedSessionIDs(event.messages, event.sessionID)
        remember(authorized, event.sessionID, ids, 500)
        if (!ids.size) {
          delete event.tools[toolName]
          return
        }
        const ordered = [...ids]
        const entries = await Promise.all(ordered.slice(0, injectedLimit).map(async id => {
          try {
            return { id, chat: await loadChat(id) }
          } catch {
            return { id }
          }
        }))
        event.system.push({ type: "text", text: formatMentionedChats(entries, ordered.slice(injectedLimit)) })
      })
      return async () => {
        authorized.clear()
        chats.clear()
        await Promise.all([tool.dispose(), hook.dispose()])
      }
    } catch (error) {
      await tool.dispose()
      throw error
    }
  },
})
