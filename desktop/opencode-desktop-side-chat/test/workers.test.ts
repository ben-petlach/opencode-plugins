import assert from "node:assert/strict"
import { test } from "node:test"
import { createRoot } from "solid-js"
import { createData } from "@opencode/client/solid"
import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { loadWorkers, sideChatParent, stopSideChat, syncActive } from "../src/workers.ts"

function fixture(run: (state: any) => Promise<void>) {
  return createRoot(dispose => {
    const infos = new Map(["main", "side", "child", "nested", "sibling"].map(id => [id, {
      id, parentID: id === "child" ? "side" : id === "nested" ? "child" : undefined,
      metadata: id !== "main" ? { desktopSideChatParent: "main" } : {},
      location: { directory: "/tmp" }, time: { created: 1, updated: 2, busy: 2 },
    } as SessionInfo]))
    const active = new Set(infos.keys())
    const calls: string[] = []
    const requests = new Map([["child", [{ id: "permission-1", sessionID: "child", action: "shell", resources: ["printf test"] }]]])
    const handlers = new Map<string, Set<(event: any) => void>>()
    const client = { session: {
      get: async ({ sessionID }) => structuredClone(infos.get(sessionID)),
      list: async ({ parentID, archived }) => ({ data: archived ? [] : [...infos.values()].filter(info => info.parentID === parentID), cursor: {} }),
      active: async () => Object.fromEntries([...active].map(id => [id, { type: "running" }])),
      interrupt: async ({ sessionID, resume }) => { assert.equal(resume, false); calls.push(`interrupt:${sessionID}`); return { interrupted: active.has(sessionID) } },
      inbox: { list: async () => [] }, form: { list: async () => [] },
    }, permission: { list: async ({ sessionID }) => requests.get(sessionID) ?? [] }, experimental: { session: { wait: async ({ sessionID }) => {
      calls.push(`wait:${sessionID}`)
      active.delete(sessionID)
      requests.delete(sessionID)
      const info = infos.get(sessionID)!
      infos.set(sessionID, { ...info, outcome: "interrupted", time: { ...info.time, idle: 10, updated: 10 } })
      if (sessionID === "child") active.add("side") // A completion report can wake the side agent.
      if (sessionID === "nested") active.add("child")
    } } } } as unknown as OpenCodeClient
    const data = createData({ api: () => client, directory: "/tmp", event: {
      on: (type, handler) => { const group = handlers.get(type) ?? new Set(); group.add(handler); handlers.set(type, group); return () => group.delete(handler) },
      listen: () => () => {},
    } })
    for (const info of infos.values()) { data.session.remember(info); data.session.setStatus(info.id, "running") }
    return run({ data, client, active, infos, calls, handlers }).finally(dispose)
  })
}

test("worker discovery follows native parents despite inherited side metadata and excludes unrelated tabs", () => fixture(async ({data, client}) => {
  const ids = await loadWorkers(data, client, "side", new AbortController().signal)
  assert.deepEqual(ids, ["side", "child", "nested"])
  assert.equal(data.session.get(ids[1]).parentID, "side")
  assert.equal(data.session.get(ids[2]).parentID, "child")
  assert.equal(sideChatParent(data.session.get, "nested"), "main")
  assert.equal(sideChatParent(data.session.get, "main"), undefined)
  data.session.remember({ ...data.session.get("nested"), parentID: "nested" })
  assert.equal(sideChatParent(id => ({ ...data.session.get(id), metadata: {} }), "nested"), undefined)
}))

test("Stop waits for workers and parent, repairs stale active state and keeps other runs active", () => fixture(async ({data, client, calls}) => {
  await loadWorkers(data, client, "side", new AbortController().signal)
  assert.equal(data.session.permission.list("child").length, 1)
  await stopSideChat(data, client, "side", new AbortController().signal)
  assert.equal(data.session.permission.list("child").length, 0)
  for (const id of ["side", "child", "nested"]) {
    assert.equal(data.session.status(id), "idle")
    assert.equal(data.session.get(id).outcome, "interrupted")
  }
  for (const id of ["main", "sibling"]) assert.equal(data.session.status(id), "running")
  assert.equal(calls.filter(call => call === "interrupt:side").length, 2)
  assert.ok(calls.indexOf("wait:child") < calls.lastIndexOf("interrupt:side"))
  assert.equal(calls.at(-1), "wait:side")
}))

test("a failed interrupt does not hide genuinely running work", () => fixture(async ({data, client}) => {
  client.session.interrupt = async () => { throw new Error("Server unavailable") }
  await assert.rejects(stopSideChat(data, client, "side", new AbortController().signal), /Server unavailable/)
  assert.equal(data.session.status("side"), "running")
}))

test("activity reconciliation preserves an execution that starts during a stale snapshot read", () => fixture(async ({data, client, handlers}) => {
  client.session.active = async () => {
    for (const handler of handlers.get("session.execution.started") ?? []) handler({ type: "session.execution.started", data: { sessionID: "side" } })
    return {}
  }
  await syncActive(data, client, ["side", "child"], new AbortController().signal)
  assert.equal(data.session.status("side"), "running")
  assert.equal(data.session.status("child"), "idle")
}))
