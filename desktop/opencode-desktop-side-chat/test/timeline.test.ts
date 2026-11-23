import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionMessageInfo } from "@opencode/client"
import { timelineRows, executionLabel, executing } from "../src/timeline.ts"
const assistant = (id: string, content: unknown[]) => ({ id, type: "assistant", time: { created: 1 }, content }) as SessionMessageInfo
const tool = (id: string, status = "completed") => ({ type: "tool", id, name: "shell", state: { status, input: { command: "pwd" }, content: [{ type: "text", text: "result" }] } })

test("adjacent execution and thinking collapse across assistant steps, with text outside groups", () => {
  const rows = timelineRows([assistant("a", [tool("one"), { type: "reasoning", text: "thinking" }]), assistant("b", [tool("two"), { type: "text", text: "Done" }])])
  assert.equal(rows.length, 2)
  const group = rows[0]; assert.equal(group.type, "execution")
  if (group.type !== "execution") throw Error("Expected group")
  assert.equal(executionLabel(group.entries), "2 Execute · 1 Thought")
  assert.equal(group.entries[0].label, "Execute")
  assert.equal(rows[1].type, "message")
})
test("streaming retains stable group and entry ids as calls complete and more arrive", () => {
  const running = timelineRows([assistant("a", [tool("one", "running")])])
  const done = timelineRows([assistant("a", [tool("one"), tool("two")])])
  assert.equal(running[0].id, done[0].id)
  if (running[0].type !== "execution" || done[0].type !== "execution") throw Error("Expected groups")
  assert.ok(executing(running[0].entries)); assert.ok(!executing(done[0].entries))
  assert.equal(running[0].entries[0].id, done[0].entries[0].id)
})
test("persisted context marker splits execution exactly at its raw message boundary", () => {
  const messages = [assistant("a", [tool("one")]), { id: "idle", type: "idle", time: { created: 2 } } as SessionMessageInfo, assistant("b", [tool("two")])]
  const updates = JSON.parse(JSON.stringify([{ id: "update1", afterID: "idle", time: 123 }]))
  const rows = timelineRows(messages, updates)
  assert.deepEqual(rows.map(row => row.type), ["execution", "update", "execution"])
  assert.equal(rows[1].id, "update1")
  assert.deepEqual(timelineRows(messages.slice(2), updates).map(row => row.type), ["execution"])
})
test("shell-only records group compactly; user messages form boundaries", () => {
  const shell = (id: string) => ({ id, type: "shell", status: "exited", command: "pwd", time: { created: 0 } }) as SessionMessageInfo
  const rows = timelineRows([shell("s1"), shell("s2"), { id: "u", type: "user", text: "Next", time: { created: 1 } } as SessionMessageInfo, shell("s3")])
  assert.deepEqual(rows.map(row => row.type), ["execution", "message", "execution"])
  if (rows[0].type !== "execution") throw Error("Expected group")
  assert.equal(executionLabel(rows[0].entries), "2 Execute")
})

test("delegation is a clickable worker record, deduplicated by child session rather than launch call", () => {
  const delegation = (id: string, description: string) => ({ type: "tool", id, name: "subagent", state: { status: "completed", input: { agent: "general", description }, metadata: { sessionID: "worker-1", status: "running" } } })
  const rows = timelineRows([assistant("a", [delegation("call-1", "First task"), { type: "text", text: "Launched" }]), assistant("b", [delegation("call-2", "Updated task")])])
  assert.deepEqual(rows.map(row => row.type), ["worker", "message"])
  assert.equal(rows[0].id, "worker:worker-1")
  if (rows[0].type !== "worker") throw Error("Expected worker")
  assert.equal(rows[0].worker.description, "Updated task")
})

test("interrupted and failed turns cannot leave unfinished tool/thinking disclosures working", () => {
  for (const outcome of ["interrupted", "failed"] as const) {
    const records = [assistant("a", [tool("one", "streaming"), { type: "reasoning", text: "In progress" }]),
      { id: "idle", type: "idle", outcome, time: { created: 2 } } as SessionMessageInfo]
    const rows = timelineRows(records)
    if (rows[0].type !== "execution") throw Error("Expected group")
    assert.ok(!executing(rows[0].entries))
    assert.deepEqual(rows[0].entries.map(entry => entry.status), [outcome, outcome])
    const fallback = timelineRows(records.slice(0,1), [], outcome)
    if (fallback[0].type !== "execution") throw Error("Expected group")
    assert.ok(!executing(fallback[0].entries))
    const next = timelineRows([...records, assistant("b", [tool("two", "running")])])
    if (next[0].type !== "execution") throw Error("Expected group")
    assert.equal(next[0].entries.at(-1)?.status, "running")
  }
})
