import assert from "node:assert/strict"
import { test } from "node:test"
import { createRoot } from "solid-js"
import { createData, type Data } from "@opencode/client/solid"
import type { SessionInfo } from "@opencode/client"
import { installSideChatActivity } from "../src/activity.ts"

const session = (id: string, parent?: string): SessionInfo => ({
  id, title: id, time: { created: 1, updated: 1, ...(parent ? { archived: 2 } : {}) },
  cost: 0, metadata: parent ? { desktopSideChatParent: parent } : {},
}) as SessionInfo

function check(run: (data: Data) => void) {
  createRoot(dispose => {
    try {
      const data = createData({
        api: () => { throw new Error("Activity projection must not call the server") },
        directory: "/tmp",
        event: { on: () => () => {}, listen: () => () => {} },
      })
      run(data)
    } finally { dispose() }
  })
}

// Desktop's native tab/sidebar indicator groups running sessions by data.session.root().
const working = (data: Data, id: string) => data.session.list().some(info =>
  data.session.root(info.id) === id && data.session.status(info.id) === "running",
)

test("archived legacy side chats mark the native parent indicator without changing execution, family or cost", () => check(data => {
  const stored = { ...session("side", "main"), cost: 3 }
  data.session.remember({ ...session("main"), cost: 7 })
  data.session.remember(structuredClone(stored))
  data.session.setStatus("side", "running")
  assert.equal(working(data, "main"), false)
  installSideChatActivity(data)
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

test("each parent remains working until its last side chat or main execution finishes", () => check(data => {
  for (const info of [session("a"), session("b"), session("a1", "a"), session("a2", "a"), session("b1", "b")])
    data.session.remember(info)
  installSideChatActivity(data)
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

test("server refreshes preserve descendant activity and unloading restores the original lookup", () => check(data => {
  const stored = session("side", "main")
  data.session.remember(session("main"))
  data.session.remember(stored)
  data.session.remember({ ...session("tool"), parentID: "side" })
  data.session.setStatus("tool", "running")
  const original = data.session.root
  const uninstall = installSideChatActivity(data)
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

test("unrelated sessions, native parents, and invalid links remain unchanged", () => check(data => {
  const fixtures = [session("plain"), session("self", "self"),
    { ...session("native", "other"), parentID: "real" },
    { ...session("invalid"), metadata: { desktopSideChatParent: 42 } }, session("empty", "")]
  fixtures.forEach(info => data.session.remember(info))
  installSideChatActivity(data)
  fixtures.forEach(info => assert.deepEqual(data.session.get(info.id), info))
}))
