import assert from "node:assert/strict"
import { test } from "node:test"
import { createRoot } from "solid-js"
import { createData, type Data } from "@opencode/client/solid"
import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { installSideChatActivity } from "../src/activity.ts"

const session = (id: string, parent?: string): SessionInfo => ({
  id, title: id, time: { created: 1, updated: 1, ...(parent ? { archived: 2 } : {}) },
  cost: 0, metadata: parent ? { desktopSideChatParent: parent } : {},
}) as SessionInfo

function check(run: (data: Data, client: OpenCodeClient, views: { sessionID: string; idle: number }[]) => void | Promise<void>) {
  return createRoot(dispose => {
    let read: Data["session"]["get"]
    const views: { sessionID: string; idle: number }[] = []
    const client = { session: {
      list: async () => ({ data: [], cursor: {} }),
      active: async () => Object.fromEntries(data.session.active().map(id => [id, { type: "running" }])),
      form: { list: async () => [] },
      get: async ({ sessionID }: { sessionID: string }) => JSON.parse(JSON.stringify(read(sessionID))),
      view: async (input: { sessionID: string; idle: number }) => {
        views.push(input)
        const info = read(input.sessionID)
        // The real server refuses future observations and never regresses a viewed watermark.
        if (info.time.idle === undefined || input.idle > info.time.idle) return
        data.session.remember({ ...info, time: { ...info.time, viewed: Math.max(info.time.viewed ?? 0, input.idle) } })
      },
    }, permission: { list: async () => [] } } as unknown as OpenCodeClient
    const data = createData({ api: () => client, directory: "/tmp", event: { on: () => () => {}, listen: () => () => {} } })
    read = data.session.get
    try { return Promise.resolve(run(data, client, views)).finally(dispose) }
    catch (error) { dispose(); throw error }
  })
}

// Desktop's native tab/sidebar indicator groups running sessions by data.session.root().
const working = (data: Data, id: string) => data.session.list().some(info =>
  data.session.root(info.id) === id && data.session.status(info.id) === "running",
)

test("archived legacy side chats mark the native parent indicator without changing execution, family or cost", () => check((data, client) => {
  const stored = { ...session("side", "main"), cost: 3 }
  data.session.remember({ ...session("main"), cost: 7 })
  data.session.remember(structuredClone(stored))
  data.session.setStatus("side", "running")
  assert.equal(working(data, "main"), false)
  installSideChatActivity(data, client, error => { throw error })
  assert.equal(working(data, "main"), true)
  assert.equal(data.session.status("main"), "idle")
  assert.equal(data.session.root("side"), "main")
  assert.ok(!data.session.family("main").includes("side"))
  assert.equal(data.session.cost("main"), 7)
  assert.deepEqual(data.session.get("side"), stored)
  assert.equal(stored.parentID, undefined)
  data.session.setStatus("side", "idle")
  assert.equal(working(data, "main"), false)
}))

test("each parent remains working until its last side chat or main execution finishes", () => check((data, client) => {
  for (const info of [session("a"), session("b"), session("a1", "a"), session("a2", "a"), session("b1", "b")])
    data.session.remember(info)
  installSideChatActivity(data, client, error => { throw error })
  data.session.setStatus("a1", "running")
  data.session.setStatus("a2", "running")
  assert.equal(working(data, "a"), true)
  assert.equal(working(data, "b"), false)
  data.session.setStatus("a1", "idle")
  assert.equal(working(data, "a"), true)
  data.session.setStatus("a", "running")
  data.session.setStatus("a2", "idle")
  assert.equal(working(data, "a"), true)
  data.session.setStatus("a", "idle")
  assert.equal(working(data, "a"), false)
  data.session.setStatus("b1", "running")
  assert.equal(working(data, "b"), true)
  assert.equal(working(data, "a"), false)
}))

test("server refreshes preserve descendant activity and unloading restores the original lookup", () => check((data, client) => {
  const stored = session("side", "main")
  data.session.remember(session("main"))
  data.session.remember(stored)
  data.session.remember({ ...session("tool"), parentID: "side" })
  data.session.setStatus("tool", "running")
  const original = data.session.root
  const uninstall = installSideChatActivity(data, client, error => { throw error })
  assert.equal(data.session.root("tool"), "main")
  assert.equal(working(data, "main"), true)
  data.session.remember({ ...stored, title: "Refreshed side chat" })
  assert.equal(data.session.root("side"), "main")
  assert.equal(data.session.get("side").title, "Refreshed side chat")
  assert.equal(new Set(data.session.family("main")).size, data.session.family("main").length)
  uninstall()
  assert.equal(data.session.root, original)
  assert.equal(data.session.root("side"), "side")
  assert.equal(data.session.root("tool"), "side")
}))

test("unrelated sessions, native parents, and invalid links remain unchanged", () => check((data, client) => {
  const fixtures = [session("plain"), session("self", "self"),
    { ...session("native", "other"), parentID: "real" },
    { ...session("invalid"), metadata: { desktopSideChatParent: 42 } }, session("empty", "")]
  fixtures.forEach(info => data.session.remember(info))
  installSideChatActivity(data, client, error => { throw error })
  fixtures.forEach(info => assert.deepEqual(data.session.get(info.id), info))
}))

const unread = (info: SessionInfo) => info.time.idle !== undefined && info.time.idle > (info.time.viewed ?? -1)

test("a background completion updates native unread, activity time and result without changing the main execution", () => check((data, client) => {
  const main = { ...session("main"), time: { created: 1, updated: 10, busy: 2, idle: 10, viewed: 10 } }
  const side = { ...session("side", "main"), outcome: "succeeded" as const, time: { created: 3, updated: 11, busy: 20, idle: 40 } }
  data.session.remember(main)
  data.session.remember(side)
  const originalGet = data.session.get
  installSideChatActivity(data, client, error => { throw error })
  assert.ok(unread(data.session.get("main")))
  assert.equal(data.session.get("main").time.updated, 40)
  assert.equal(data.session.get("main").time.busy, 20)
  assert.equal(data.session.get("main").time.idle, 40)
  assert.equal(data.session.get("main").outcome, "succeeded")
  assert.equal(data.session.list().find(info => info.id === "main")?.time.updated, 40)
  assert.deepEqual(originalGet("main"), main)
  assert.equal(data.session.status("main"), "idle")
}))

test("elapsed work uses the earliest current run even if a sibling finished later", () => check((data, client) => {
  data.session.remember({ ...session("main"), time: { created: 1, updated: 10, idle: 10, viewed: 10 } })
  data.session.remember({ ...session("one", "main"), time: { created: 1, updated: 10, busy: 20, idle: 10 } })
  data.session.remember({ ...session("two", "main"), time: { created: 1, updated: 10, busy: 25, idle: 30, viewed: 30 } })
  data.session.setStatus("one", "running")
  installSideChatActivity(data, client, error => { throw error })
  assert.equal(data.session.get("main").time.busy, 20)
  assert.equal(data.session.get("main").time.idle, undefined)
  assert.equal(data.session.get("main").time.updated, 30)
  assert.ok(working(data, "main"))
  data.session.remember({ ...session("one", "main"), time: { created: 1, updated: 10, busy: 20, idle: 50 } })
  data.session.setStatus("one", "idle")
  assert.equal(data.session.get("main").time.idle, 50)
  assert.ok(unread(data.session.get("main")))
}))

test("native mark-read acknowledges only observed completions, persists on the correct sessions and restores on unload", () => check(async (data, client, views) => {
  data.session.remember({ ...session("main"), time: { created: 1, updated: 10, idle: 10 } })
  data.session.remember({ ...session("one", "main"), time: { created: 1, updated: 15, idle: 20 } })
  data.session.remember({ ...session("two", "main"), time: { created: 1, updated: 25, idle: 40 } })
  const originalView = client.session.view
  const uninstall = installSideChatActivity(data, client, error => { throw error })
  await client.session.view({ sessionID: "main", idle: 20 })
  assert.deepEqual(views, [{ sessionID: "main", idle: 10 }, { sessionID: "one", idle: 20 }])
  assert.ok(unread(data.session.get("main")), "newer completion must remain unread")
  await client.session.view({ sessionID: "main", idle: 40 })
  assert.equal(unread(data.session.get("main")), false)
  assert.equal(data.session.get("two").time.viewed, 40)
  uninstall()
  assert.equal(client.session.view, originalView)
  assert.equal(data.session.get("main").time.updated, 10)
  assert.equal(data.session.get("main").time.idle, 10)
  installSideChatActivity(data, client, error => { throw error })
  assert.equal(data.session.get("main").time.updated, 40)
  assert.equal(unread(data.session.get("main")), false)
}))

test("an older unread side result is not hidden by a newer read result and failures stay visible", () => check((data, client) => {
  data.session.remember({ ...session("main"), time: { created: 1, updated: 50, idle: 50, viewed: 50 } })
  data.session.remember({ ...session("side", "main"), time: { created: 1, updated: 10, idle: 20 } })
  installSideChatActivity(data, client, error => { throw error })
  assert.ok(unread(data.session.get("main")))
  data.session.remember({ ...session("side", "main"), outcome: "failed", time: { created: 1, updated: 10, idle: 60 } })
  assert.equal(data.session.get("main").outcome, "failed")
  assert.equal(data.session.get("main").time.updated, 60)
}))

test("archived side history hydrates across pages and desktop index readers receive the same summaries", () => check(async (data, client) => {
  const main = { ...session("main"), time: { created: 1, updated: 10, idle: 10, viewed: 10 } }
  const side = { ...session("side", "main"), time: { created: 1, updated: 11, idle: 40, viewed: 40, archived: 2 } }
  const calls: unknown[] = []
  client.session.list = async input => {
    calls.push(input)
    if (input?.parentID) return { data: [], cursor: {} }
    return input?.cursor ? { data: [side], cursor: {} } : { data: [main], cursor: { next: "page2" } }
  }
  const desktop = data.session as typeof data.session & { known: typeof data.session.list; apply: (infos: readonly SessionInfo[]) => SessionInfo[] }
  desktop.known = desktop.list
  desktop.apply = infos => [...infos]
  const uninstall = installSideChatActivity(data, client, error => { throw error })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.filter((input: any) => !input.parentID).length, 2)
  assert.equal(data.session.get("main").time.updated, 40)
  assert.equal(unread(data.session.get("main")), false)
  assert.equal(desktop.known().find(info => info.id === "main")?.time.updated, 40)
  assert.equal(desktop.apply([main])[0].time.updated, 40)
  uninstall()
  assert.deepEqual(desktop.apply([main]), [main])
}))

test("reload hydrates inherited-metadata workers and reconciles stale interrupted activity with the server", () => check(async (data, client) => {
  const main = { ...session("main"), time: { created: 1, updated: 10, idle: 10, viewed: 10 } }
  const side = { ...session("side", "main"), outcome: "interrupted" as const, time: { created: 1, updated: 30, busy: 20, idle: 30, archived: 2 } }
  const child = { ...session("worker", "main"), parentID: "side", outcome: "interrupted" as const, time: { created: 3, updated: 40, busy: 25, idle: 40 } }
  data.session.remember(main)
  data.session.remember(side)
  data.session.setStatus("side", "running")
  data.session.setStatus("worker", "running")
  client.session.active = async () => ({})
  client.session.list = async input => ({ data: !input?.parentID ? [side]
    : input.parentID === "side" && !input.archived ? [child] : [], cursor: {} })
  const uninstall = installSideChatActivity(data, client, error => { throw error })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(working(data, "main"), false)
  assert.equal(data.session.get("worker").parentID, "side")
  assert.equal(data.session.get("main").time.updated, 40)
  assert.equal(data.session.get("main").outcome, "interrupted")
  assert.equal(data.session.status("side"), "idle")
  assert.equal(data.session.status("worker"), "idle")
  uninstall()
}))
