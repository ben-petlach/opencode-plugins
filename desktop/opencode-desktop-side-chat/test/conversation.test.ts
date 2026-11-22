import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionMessageInfo } from "@opencode/client"
import { conversationLines, shareText } from "../src/conversation.ts"
import { duration, tokensPerSecond } from "../src/session-turn.ts"

test("transcript preserves prompt, attachments, thinking-only and tool-only records", () => {
  const records = [
    { id: "u", type: "user", time: { created: 0 }, text: "select me\nline two", files: [{ name: "test.pdf" }] },
    { id: "a", type: "assistant", time: { created: 100 }, content: [{ type: "reasoning", text: "Thinking" }] },
    { id: "b", type: "assistant", time: { created: 200 }, content: [{ type: "tool", name: "read", state: { status: "running" } }] },
  ] as unknown as SessionMessageInfo[]
  const lines = conversationLines(records)
  assert.equal(lines.length, 3)
  assert.equal(lines[0].text, "select me\nline two")
  assert.deepEqual(lines[0].files, ["test.pdf"])
  assert.equal(lines[1].message, records[1])
  assert.equal(lines[2].message, records[2])
  assert.ok(!shareText(lines).includes('"status":"running"'))
})

test("turn metrics aggregate provider-active intervals, excluding first-token wait and tool time", () => {
  const messages = [
    { id: "u", type: "user", time: { created: 0 } },
    { id: "a", type: "assistant", time: { created: 100, firstToken: 1000, streamed: 2000, completed: 3000 }, tokens: { output: 80, reasoning: 20 } },
    { id: "b", type: "assistant", time: { created: 4000, firstToken: 5000, streamed: 7000, completed: 7100 }, tokens: { output: 200, reasoning: 0 } },
  ]
  assert.equal(tokensPerSecond(messages, messages[2]), 100)
  assert.equal(duration(messages, messages[2]), 7100)
})

test("missing stream measurements never produce an invented token rate", () => {
  const step = { id: "a", type: "assistant", time: { created: 100, completed: 2000 }, tokens: { output: 100, reasoning: 0 } }
  assert.equal(tokensPerSecond([step], step), undefined)
})

test("shell output is retained as selectable transcript text", () => {
  const message = { id: "s", type: "shell", time: { created: 0 }, command: "printf test", output: { output: "test" } } as unknown as SessionMessageInfo
  assert.equal(conversationLines([message])[0].text, "$ printf test\ntest")
})
