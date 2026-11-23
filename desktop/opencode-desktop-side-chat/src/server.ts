import { Plugin } from "@opencode/plugin"
import type { JsonSchema } from "effect"
import { createInspector, InspectorError } from "./tool-inspector.ts"

const names = {
  sessions: "main_chat_list_sessions",
  calls: "main_chat_list_tool_calls",
  call: "main_chat_read_tool_call",
  search: "main_chat_search",
  messages: "main_chat_read_messages",
} as const

const sessionID = { type: "string", minLength: 1, description: "Main chat or native sub-agent session ID." } as const
const offset = { type: "integer", minimum: 0 } as const
const limit = (maximum: number) => ({ type: "integer" as const, minimum: 1, maximum })
const string = { type: "string", minLength: 1 } as const
const boolean = { type: "boolean" } as const
const choice = (...values: string[]) => ({ type: "string" as const, enum: values })
const parentOf = (metadata: Record<string, unknown> | undefined) => {
  const parent = metadata?.desktopSideChatParent
  return typeof parent === "string" && parent ? parent : null
}

export default Plugin.define({
  id: "opencode-desktop-side-chat",
  async setup(ctx) {
    const tools = await ctx.tool.transform(editor => {
      function add<Input>(
        name: string, description: string, properties: Record<string, JsonSchema.JsonSchema>,
        select: (inspector: ReturnType<typeof createInspector>) => (input: Input) => Promise<unknown>,
        required: string[] = [],
      ) {
        editor.add({
          name, description, options: { codemode: false },
          input: { type: "object", properties, required, additionalProperties: false },
          async execute(input, context) {
            const signal = context.signal
            signal?.throwIfAborted()
            const session = await ctx.session.get({ sessionID: context.sessionID }, { signal })
            const parentID = parentOf(session.metadata)
            if (!parentID) return { content: "This read-only tool is only available inside a Side Chat session." }
            try {
              const inspector = createInspector(ctx.session, parentID, { signal })
              return { content: JSON.stringify(await select(inspector)(input as Input)) }
            } catch (error) {
              if (error instanceof InspectorError) return { content: JSON.stringify({ error: error.message }) }
              throw error
            }
          },
        })
      }

      add(names.sessions,
        "List the linked main chat and its active/archived nested sub-agents. Use session IDs to narrow subsequent live reads.",
        { includeCounts: boolean }, inspector => inspector.listSessions)
      add(names.calls,
        "Browse the live chronological tool-call index with previews. Filter by session, tool name, or status; use a call ID to read the full retained input/output/error.",
        { sessionID, includeSubagents: boolean, toolName: string,
          status: choice("completed", "error", "running", "streaming", "pending"), offset, limit: limit(200) },
        inspector => inspector.listToolCalls)
      add(names.call,
        "Read a call's full retained input, output, or error (inline data excluded). Provide the session ID when known. Use character offset/limit and nextOffset to page without losing the middle.",
        { callID: string, sessionID, section: choice("all", "input", "output", "error"), offset, limit: limit(40_000) },
        inspector => inspector.readToolCall, ["callID"])
      add(names.search,
        "Search live messages and full retained tool inputs, outputs, and errors—not just snapshot previews. For tool hits, pass callID, sessionID, section, and matchOffset as offset to main_chat_read_tool_call.",
        { query: string, regex: boolean, scope: choice("all", "main", "subagents"), sessionID,
          includeMessages: boolean, includeTools: boolean, limit: limit(50) },
        inspector => inspector.searchHistory, ["query"])
      add(names.messages,
        "Read live main-chat or sub-agent messages, including turns after the snapshot. With no offset returns the newest page in chronological order. Keep fromEnd=true when paging back with nextOffset.",
        { sessionID, offset, limit: limit(50), fromEnd: boolean, includeToolSummaries: boolean },
        inspector => inspector.readMessages)
    })
    const parents = new Map<string, string | null>()
    try {
      const hook = await ctx.session.hook("context", async event => {
        const toolNames = Object.values(names)
        if (!toolNames.some(name => name in event.tools)) return
        let parent = parents.get(event.sessionID)
        if (parent === undefined) {
          try {
            parent = parentOf((await ctx.session.get({ sessionID: event.sessionID })).metadata)
            if (parents.size >= 500) parents.delete(parents.keys().next().value!)
            parents.set(event.sessionID, parent)
          } catch {
            // Fail closed for this request, but retry classification after a transient failure.
          }
        }
        if (!parent) for (const name of toolNames) delete event.tools[name]
      })
      return async () => {
        parents.clear()
        await Promise.all([tools.dispose(), hook.dispose()])
      }
    } catch (error) {
      await tools.dispose()
      throw error
    }
  },
})
