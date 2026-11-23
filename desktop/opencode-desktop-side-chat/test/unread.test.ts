import assert from "node:assert/strict"
import { test } from "node:test"
import { hasRunningDescendant, isSideTabUnread, markSeenIdle, sideTabStatus } from "../src/unread.ts"

test("running side tabs and tabs with active workers are not unread", () => {
  assert.equal(isSideTabUnread({ running: true, idle: 20, tabViewedIdle: 10 }), false)
  assert.equal(isSideTabUnread({ running: false, hasActiveWorkers: true, idle: 20, tabViewedIdle: 10 }), false)
})

test("a side tab without a completion is not unread", () => {
  assert.equal(isSideTabUnread({ running: false }), false)
  assert.equal(isSideTabUnread({ running: false, viewed: 20, tabViewedIdle: 10 }), false)
})

test("parent read receipts do not clear a newer side tab completion", () => {
  assert.equal(isSideTabUnread({ running: false, idle: 20, viewed: 20, tabViewedIdle: 10 }), true)
  assert.equal(isSideTabUnread({ running: false, idle: 20, viewed: 30, tabViewedIdle: 0 }), true)
})

test("viewing a side tab clears unread until a later completion", () => {
  const tabViewedIdle = markSeenIdle(10, 20)
  assert.equal(tabViewedIdle, 20)
  assert.equal(isSideTabUnread({ running: false, idle: 20, viewed: 10, tabViewedIdle }), false)
  assert.equal(isSideTabUnread({ running: false, idle: 30, viewed: 30, tabViewedIdle }), true)
})

test("pre-upgrade threads use the server read receipt when no tab watermark exists", () => {
  assert.equal(isSideTabUnread({ running: false, idle: 20, viewed: 20 }), false)
  assert.equal(isSideTabUnread({ running: false, idle: 20, viewed: 30 }), false)
  assert.equal(isSideTabUnread({ running: false, idle: 20, viewed: 10 }), true)
  assert.equal(isSideTabUnread({ running: false, idle: 0 }), true)
})

test("marking a tab seen initializes its watermark and never moves it backward", () => {
  assert.equal(markSeenIdle(undefined, 20), 20)
  assert.equal(markSeenIdle(30, 20), 30)
})

test("working takes precedence over unread; otherwise seen and empty tabs are idle", () => {
  assert.equal(sideTabStatus({ running: true, idle: 20, tabViewedIdle: 10 }), "working")
  assert.equal(sideTabStatus({ running: false, hasActiveWorkers: true, idle: 20, tabViewedIdle: 10 }), "working")
  assert.equal(sideTabStatus({ running: false, hasActiveWorkers: true }), "working")
  assert.equal(sideTabStatus({ running: false, idle: 20, viewed: 20, tabViewedIdle: 10 }), "unread")
  assert.equal(sideTabStatus({ running: false, idle: 20, tabViewedIdle: 20 }), "idle")
  assert.equal(sideTabStatus({ running: false }), "idle")
})

const family = [
  { id: "nested", parentID: "worker" },
  { id: "deep", parentID: "nested" },
  { id: "worker", parentID: "side" },
  { id: "unrelated", parentID: "other-side" },
]

test("finds a running direct worker or a running multi-hop descendant", () => {
  assert.equal(hasRunningDescendant(family, "side", id => id === "worker"), true)
  assert.equal(hasRunningDescendant(family, "side", id => id === "deep"), true)
})

test("running unrelated sessions and the root do not count as workers", () => {
  assert.equal(hasRunningDescendant(family, "side", id => id === "unrelated" || id === "side"), false)
  assert.equal(hasRunningDescendant(family, "missing", () => true), false)
})

test("cyclic worker links are visited once without suppressing running descendants", () => {
  const cyclic = [...family, { id: "side", parentID: "deep" }, { id: "worker", parentID: "nested" }]
  const checked: string[] = []
  assert.equal(hasRunningDescendant(cyclic, "side", id => { checked.push(id); return false }), false)
  assert.deepEqual(checked.sort(), ["deep", "nested", "worker"])
  assert.equal(hasRunningDescendant(cyclic, "side", id => id === "deep"), true)
})
