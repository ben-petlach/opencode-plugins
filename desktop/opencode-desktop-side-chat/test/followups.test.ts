import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionMessageAssistant, SessionMessageIdle, SessionMessageShell, SessionMessageUser } from "@opencode/client"
import { filterPrediction, FollowupsContract, hasAssistantReply, latestTurn, shouldAutoSuggest, withLegacyMessages } from "../src/followups.ts"

const time = { created: 1 }
const user: SessionMessageUser = { type: "user", id: "u", time, text: "Can you check?" }
const assistant: SessionMessageAssistant = {
  type: "assistant", id: "a", time, agent: "build", model: { providerID: "test", id: "model" },
  content: [{ type: "text", text: "The check passed." }],
}
const idle: SessionMessageIdle = { type: "idle", id: "i", time, outcome: "succeeded" }
const shell: SessionMessageShell = { type: "shell", id: "s", time, shellID: "shell", command: "true", status: "exited" }

test("defines the shared follow-ups contract ID", () => {
  assert.equal(FollowupsContract.id, "opencode-desktop-followups.suggestions")
})

test("latestTurn skips non-turn records and preserves the latest user, assistant or idle record", () => {
  assert.equal(latestTurn([]), undefined)
  assert.equal(latestTurn([shell]), undefined)
  assert.equal(latestTurn([assistant, idle, user, shell]), user)
  assert.equal(latestTurn([user, assistant, shell]), assistant)
  assert.equal(latestTurn([user, assistant, idle, shell]), idle)
})

test("auto-suggestions require a successful idle marker after the latest textual assistant reply", () => {
  const reasoning = { ...assistant, content: [{ type: "reasoning" as const, text: "Thinking" }] }
  const blank = { ...assistant, content: [{ type: "text" as const, text: " \n " }] }
  assert.equal(shouldAutoSuggest([user, assistant, shell, idle, shell]), true)
  assert.equal(shouldAutoSuggest([user, { ...assistant, content: [...reasoning.content, ...assistant.content] }, idle]), true)
  assert.equal(shouldAutoSuggest([user, assistant, { ...idle, outcome: "failed" }]), false)
  assert.equal(shouldAutoSuggest([user, assistant, { ...idle, outcome: "interrupted" }]), false)
  assert.equal(shouldAutoSuggest([user, reasoning, idle]), false)
  assert.equal(shouldAutoSuggest([user, assistant, blank, idle]), false)
  assert.equal(shouldAutoSuggest([user, assistant, user, idle]), false)
  assert.equal(shouldAutoSuggest([user, assistant, idle, idle]), false)
  assert.equal(shouldAutoSuggest([user, idle]), false)
  assert.equal(shouldAutoSuggest([user, assistant]), false)
  assert.equal(shouldAutoSuggest([user, assistant, idle, user]), false)
  assert.equal(shouldAutoSuggest([]), false)
})

test("manual suggestions only require some assistant message", () => {
  assert.equal(hasAssistantReply([user, { ...assistant, content: [] }, idle, user]), true)
  assert.equal(hasAssistantReply([user, shell, idle]), false)
  assert.equal(hasAssistantReply([]), false)
})

test("legacy turns are prepended in order as typed user and assistant records", () => {
  const live = [user, assistant, idle] as const
  assert.equal(withLegacyMessages([], live), live)
  const history = withLegacyMessages([
    { question: "first question", answer: "first answer" },
    { question: "second question", answer: "second answer" },
  ], live)
  assert.deepEqual(history.slice(0, 4).map(message => [
    message.id, message.type, message.type === "user" ? message.text : message.type === "assistant" ? message.content : undefined,
  ]), [
    ["legacy-user-0", "user", "first question"],
    ["legacy-assistant-0", "assistant", [{ type: "text", text: "first answer" }]],
    ["legacy-user-1", "user", "second question"],
    ["legacy-assistant-1", "assistant", [{ type: "text", text: "second answer" }]],
  ])
  assert.deepEqual(history.slice(4), live)
  assert.equal(history[4], user)
  assert.equal(shouldAutoSuggest(history), true)
})

test("prediction filtering delegates matching for both the primary and choices", () => {
  const prediction = { primary: "Check logs", choices: ["Check logs", "Check tests", "Run tests"] } as const
  const prefix = (choice: string, draft: string) => choice.length > draft.length && choice.toLowerCase().startsWith(draft.toLowerCase())
  assert.equal(filterPrediction(undefined, "", prefix), undefined)
  assert.deepEqual(filterPrediction(prediction, "", prefix), prediction)
  assert.deepEqual(filterPrediction(prediction, "cHECk", prefix), { primary: "Check logs", choices: ["Check logs", "Check tests"] })
  assert.deepEqual(filterPrediction(prediction, "check logs", prefix), { choices: [] })
  assert.deepEqual(filterPrediction(prediction, "RUN", prefix), { choices: ["Run tests"] })
  assert.deepEqual(filterPrediction({ choices: ["Run tests"] }, "", prefix), { choices: ["Run tests"] })
})
