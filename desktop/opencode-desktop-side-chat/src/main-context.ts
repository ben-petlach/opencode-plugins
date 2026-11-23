import type { OpenCodeClient } from "@opencode/client"
import { mainContext, type AgentContext, type Turn } from "./conversation.ts"

export async function readMainContext(client: OpenCodeClient, sessionID: string, legacy: readonly Turn[], signal: AbortSignal) {
  const messages = await client.session.context({ sessionID }, { signal })
  const agents: AgentContext[] = []
  const visited = new Set([sessionID])
  const queue = [sessionID]
  // Keep the upfront overview cheap; live inspection can scan a wider tree.
  const limit = 24
  parents: for (const parentID of queue) {
    for (const archived of [false, true]) {
      let cursor: string | undefined
      do {
        const page = await client.session.list({ parentID, archived, limit: 100, ...(cursor ? { cursor } : { order: "desc" }) }, { signal })
        for (const child of page.data) {
          if (child.parentID !== parentID || child.metadata?.desktopSideChatParent || visited.has(child.id)) continue
          visited.add(child.id)
          agents.push({
            id: child.id, parentID, agent: child.agent, title: child.title,
            messages: await client.session.context({ sessionID: child.id }, { signal }),
          })
          queue.push(child.id)
          if (agents.length === limit) break parents
        }
        cursor = page.cursor.next ?? undefined
      } while (cursor)
    }
  }
  const snapshot = mainContext(messages, legacy, agents)
  if (agents.length === limit) snapshot.note += ` The overview reached its ${limit}-sub-agent limit; use the live tools to inspect beyond it.`
  return snapshot
}
