import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import type { Data } from "@opencode/client/solid"
import { createMemo } from "solid-js"
import { loadWorkers, syncActive } from "./workers.ts"

type DesktopSessions = Data["session"] & {
  known?: Data["session"]["list"]
  apply?: (infos: readonly SessionInfo[], options?: { reloads: true }) => SessionInfo[]
}

// shortcut: Desktop 2.3.2 has no activity hook; adapt its native root, session-summary and viewed APIs.
export function installSideChatActivity(data: Data, client: OpenCodeClient, report: (error: unknown) => void) {
  const session = data.session as DesktopSessions
  const original = { root: session.root, get: session.get, list: session.list, known: session.known, apply: session.apply, view: client.session.view }
  const controller = new AbortController()
  const root = (sessionID: string) => {
    const id = original.root(sessionID)
    const parentID = original.get(id)?.metadata?.desktopSideChatParent
    return typeof parentID === "string" && parentID && parentID !== id ? original.root(parentID) : id
  }
  const groups = createMemo(() => {
    const result = new Map<string, SessionInfo[]>()
    for (const info of original.list()) {
      const parent = root(info.id)
      if (parent === original.root(info.id)) continue
      const list = result.get(parent) ?? []
      list.push(info)
      result.set(parent, list)
    }
    return result
  })
  function project(info: SessionInfo) {
    const sides = groups().get(info.id)
    if (!sides?.length) return info
    const members = [info, ...sides]
    const last = members.reduce((latest, item) => (item.time.idle ?? -1) > (latest.time.idle ?? -1) ? item : latest)
    const running = members.filter(item => data.session.status(item.id) === "running")
    const starts = running.flatMap(item => item.time.busy !== undefined && (item.time.idle === undefined || item.time.busy >= item.time.idle) ? [item.time.busy] : [])
    const unread = members.some(item => item.time.idle !== undefined && item.time.idle > (item.time.viewed ?? -1))
    const idle = last.time.idle
    return { ...info, outcome: last.outcome, time: { ...info.time,
      updated: Math.max(info.time.updated, ...sides.map(item => item.time.idle ?? 0)),
      busy: running.length ? starts.length ? Math.min(...starts) : undefined : last.time.busy,
      idle: running.length ? undefined : idle,
      viewed: idle === undefined ? info.time.viewed : unread ? Math.min(info.time.viewed ?? 0, idle - 1) : Math.max(info.time.viewed ?? 0, idle),
    } }
  }
  const get = (id: string) => { const info = original.get(id); return info ? project(info) : info }
  const list = () => original.list().map(project)
  const known = original.known ? () => original.known!().map(project) : undefined
  const apply = original.apply ? (infos: readonly SessionInfo[], options?: { reloads: true }) => original.apply!(infos, options).map(project) : undefined
  const view: OpenCodeClient["session"]["view"] = async (input, options) => {
    const sides = groups().get(input.sessionID)
    if (!sides?.length) return original.view(input, options)
    const parent = original.get(input.sessionID)
    const observed = [...(parent ? [parent] : []), ...sides].flatMap(info =>
      info.time.idle !== undefined && info.time.idle <= input.idle && info.time.idle > (info.time.viewed ?? -1)
        ? [{ sessionID: info.id, idle: info.time.idle }] : [],
    )
    await Promise.all(observed.map(async item => {
      await original.view(item, options)
      data.session.invalidate(item.sessionID)
      await data.session.sync(item.sessionID, { children: false })
    }))
  }
  session.root = root
  session.get = get
  session.list = list
  if (known) session.known = known
  if (apply) session.apply = apply
  client.session.view = view

  // Archived side sessions must be known after a reload even when their panels have never opened.
  void (async () => {
    const infos: SessionInfo[] = []
    let cursor: string | undefined
    do {
      const page = await client.session.list({ archived: true, limit: 200, ...(cursor ? { cursor } : { order: "desc" }) }, { signal: controller.signal })
      if (controller.signal.aborted) return
      infos.push(...page.data)
      cursor = page.cursor.next ?? undefined
    } while (cursor)
    const sides = infos.filter(info => !info.parentID && typeof info.metadata?.desktopSideChatParent === "string" && info.metadata.desktopSideChatParent !== info.id)
    sides.forEach(data.session.remember)
    const family = new Set<string>()
    for (const side of sides) {
      for (const id of await loadWorkers(data, client, side.id, controller.signal)) family.add(id)
    }
    if (family.size) await syncActive(data, client, [...family], controller.signal)
    for (const id of new Set(sides.map(info => info.metadata!.desktopSideChatParent as string))) {
      if (controller.signal.aborted) return
      const info = infos.find(info => info.id === id)
      if (!original.get(id) && info) data.session.remember(info)
      // Re-read the parent so native computations mounted before plugin activation adopt the summary lookup.
      data.session.invalidate(id)
      await data.session.sync(id, { children: false })
    }
  })().catch(error => { if (!controller.signal.aborted) report(error) })

  return () => {
    controller.abort()
    if (session.root === root) session.root = original.root
    if (session.get === get) session.get = original.get
    if (session.list === list) session.list = original.list
    if (known && session.known === known) session.known = original.known
    if (apply && session.apply === apply) session.apply = original.apply
    if (client.session.view === view) client.session.view = original.view
  }
}
