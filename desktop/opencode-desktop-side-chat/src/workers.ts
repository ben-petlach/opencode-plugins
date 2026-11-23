import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import type { Data } from "@opencode/client/solid"

export function sideChatParent(get: (id: string) => SessionInfo | undefined, id: string) {
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const info = get(id)
    const parent = info?.metadata?.desktopSideChatParent
    if (typeof parent === "string" && parent) return parent
    id = info?.parentID ?? ""
  }
}

export async function loadWorkers(data: Data, client: OpenCodeClient, sessionID: string, signal: AbortSignal) {
  const queue = [sessionID]
  const visited = new Set(queue)
  for (const parentID of queue) {
    for (const archived of [false, true]) {
      let cursor: string | undefined
      do {
        const page = await client.session.list({ parentID, archived, limit: 100, ...(cursor ? { cursor } : { order: "desc" }) }, { signal })
        signal.throwIfAborted()
        for (const info of page.data) {
          if (info.parentID !== parentID || visited.has(info.id)) continue
          visited.add(info.id)
          queue.push(info.id)
          data.session.remember(info)
          await Promise.all([
            data.session.permission.sync(info.id),
            data.session.form.sync(info.id, info.location),
          ])
        }
        cursor = page.cursor.next ?? undefined
      } while (cursor)
    }
  }
  return queue
}

// A server snapshot repairs missed activity events; newer events win over an in-flight read.
export async function syncActive(data: Data, client: OpenCodeClient, ids: readonly string[], signal: AbortSignal) {
  const changed = new Set<string>()
  const off = (["session.execution.started", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"] as const)
    .map(type => data.on(type, event => changed.add(event.data.sessionID)))
  try {
    const active = await client.session.active({ signal })
    signal.throwIfAborted()
    for (const id of ids) if (!changed.has(id)) data.session.setStatus(id, active[id] ? "running" : "idle")
  } finally { off.forEach(dispose => dispose()) }
}

export async function stopSideChat(data: Data, client: OpenCodeClient, sessionID: string, signal: AbortSignal) {
  await client.session.interrupt({ sessionID, resume: false }, { signal })
  const ids = await loadWorkers(data, client, sessionID, signal)
  const children = ids.slice(1)
  await Promise.all(children.map(id => client.session.interrupt({ sessionID: id, resume: false }, { signal })))
  for (const id of children.toReversed()) {
    await client.session.interrupt({ sessionID: id, resume: false }, { signal })
    await client.experimental.session.wait({ sessionID: id }, { signal })
  }
  // Child completion reports can wake their parent; stop again after all workers have settled.
  await client.session.interrupt({ sessionID, resume: false }, { signal })
  await client.experimental.session.wait({ sessionID }, { signal })
  await Promise.all(ids.map(async id => {
    data.session.invalidate(id)
    data.session.pending.invalidate(id)
    data.session.message.invalidate(id)
    data.session.permission.invalidate(id)
    data.session.form.invalidate(id)
    await Promise.all([data.session.sync(id, { children: false }), data.session.pending.sync(id),
      data.session.permission.sync(id), data.session.form.sync(id)])
  }))
  await syncActive(data, client, ids, signal)
  if (ids.some(id => data.session.status(id) === "running")) throw new Error("Side chat is still stopping. Open its worker to inspect pending cleanup.")
}
