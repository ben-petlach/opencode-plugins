import { test } from "node:test"
import assert from "node:assert/strict"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { buildPrompt, matchesDraft, parseFollowUps, type Prediction } from "../src/model"
import { createSuggestions } from "../src/request"

test("parses wrapped JSON, excludes reasoning, rejects malformed and oversized suggestions", () => {
  assert.deepEqual(parseFollowUps('<think>{"follow_ups":["secret"]}</think>```json\n{"follow_ups":["Add tests", "add  tests", 7, "", "Explain it", "Review it", "Fourth"]}\n```'), { choices: ["Add tests", "Explain it", "Review it"] })
  for (const text of ["", "no JSON", '{"follow_ups":"wrong"}', '{"follow_ups":["' + 'x'.repeat(161) + '"]}']) assert.deepEqual(parseFollowUps(text), { choices: [] })
})

test("sends bounded conversation text, excluding reasoning and tool output", () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({ text: `turn${i} ${"x".repeat(3000)}` }))
  messages.push({ type: "assistant", content: [{ type: "text", text: "Completed" }, { type: "reasoning", text: "PRIVATE" }, { type: "tool", text: "TOOL_SECRET" }] } as never)
  const { prompt } = buildPrompt(messages as SessionMessageInfo[])
  assert(!prompt.includes("turn0"))
  assert(!prompt.includes("x".repeat(1501)))
  assert(!prompt.includes("PRIVATE"))
  assert(!prompt.includes("TOOL_SECRET"))
  assert(prompt.includes("Completed"))
  assert(prompt.includes("<latest_user_message>\n\nturn7"))
})

test("preserves the closing decision of a long latest reply, ahead of older context", () => {
  const question = "Want me to add the new template to all 12 examples with the same heading?"
  const reply = "Latest finding: keep the subject constant.\n" + "Body details. ".repeat(1000) + question
  const { prompt } = buildPrompt([
    { type: "user", text: "Old request: write a second template" },
    { type: "assistant", content: [{ type: "text", text: reply }] },
  ] as SessionMessageInfo[])
  const latest = prompt.split("<latest_assistant_reply>")[1]!.split("</latest_assistant_reply>")[0]!
  assert(latest.includes(question), "Closing proposal must survive truncation")
  assert(latest.includes("Latest finding: keep the subject constant."))
  assert(!latest.includes("Old request"))
  assert(latest.length < 6100, "Bound context even for very long replies")
  assert(prompt.includes("include both acceptance and decline or deferral"))
  assert(prompt.includes("Do not accept, decline, or bundle an out-of-scope offer in any draft."))
})

function deferred() {
  let resolve!: (value: { text: string }) => void
  const promise = new Promise<{ text: string }>((done) => { resolve = done })
  return { promise, resolve }
}

test("cancelled request cannot publish even when provider ignores abort", async () => {
  let items: Prediction | undefined
  const pending = deferred()
  const requests = createSuggestions((value) => { items = value }, () => assert.fail("Unexpected error"))
  const run = requests.run(() => pending.promise, () => true)
  requests.clear()
  pending.resolve({ text: '{"follow_ups":["Stale"]}' })
  await run
  assert.equal(items, undefined)
})

test("new request wins over older response; ineligible sessions block publication", async () => {
  let items: Prediction | undefined
  let eligible = true
  const requests = createSuggestions((value) => { items = value }, () => {})
  const old = deferred()
  const run = requests.run(() => old.promise, () => eligible)
  await requests.run(async () => ({ text: '{"follow_ups":["New"]}' }), () => eligible)
  old.resolve({ text: '{"follow_ups":["Old"]}' })
  await run
  assert.deepEqual(items, { choices: ["New"] })
  const draft = deferred()
  const next = requests.run(() => draft.promise, () => eligible)
  eligible = false
  draft.resolve({ text: '{"follow_ups":["Do not overwrite draft"]}' })
  await next
  assert.equal(items, undefined)
})

test("ineligible session makes no model call; errors leave no suggestions", async () => {
  const errors: unknown[] = []
  const requests = createSuggestions(() => {}, (error) => errors.push(error))
  await requests.run(async () => { assert.fail("Must not call provider") }, () => false)
  await requests.run(async () => { throw new Error("offline") }, () => true)
  assert.equal(errors.length, 1)
})

test("orders only a valid primary first and preserves literal paths", () => {
  assert.deepEqual(parseFollowUps('{"follow_ups":["Use A", "Check /tmp/a  b", "Decline"],"primary":1}'), {
    primary: "Check /tmp/a  b", choices: ["Check /tmp/a  b", "Use A", "Decline"],
  })
  for (const primary of [null, 1, 4, "0"]) {
    assert.deepEqual(parseFollowUps(JSON.stringify({ follow_ups: ["Use A", "use a"], primary })), { choices: ["Use A"] })
  }
})

test("uses the latest substantive user message as the style reference", () => {
  const { prompt } = buildPrompt([
    { type: "user", text: "can you check that" },
    { type: "assistant", content: [{ type: "text", text: "I can check that." }] },
    { type: "user", text: "yes" },
    { type: "assistant", content: [{ type: "text", text: "Checked." }] },
  ] as SessionMessageInfo[])
  assert.match(prompt, /<latest_user_message>\s+can you check that\s+<\/latest_user_message>/)
  assert(prompt.includes("USER: yes"))
})

test("only strict case-insensitive prefixes match", () => {
  for (const draft of ["", "can you", "CAN You "]) assert(matchesDraft("Can you check?", draft))
  for (const draft of ["can we", "can you check?", " can you", "/"]) assert(!matchesDraft("Can you check?", draft))
})

test("matches the user's opening case while preserving names, commands, and paths", () => {
  const output = '{"follow_ups":["Can you check /tmp/Sync?","OpenCode is the culprit","/SuggestNext"],"primary":0}'
  assert.deepEqual(parseFollowUps(output, "lower"), {
    primary: "can you check /tmp/Sync?", choices: ["can you check /tmp/Sync?", "OpenCode is the culprit", "/SuggestNext"],
  })
  assert.deepEqual(parseFollowUps('{"follow_ups":["could you check?","npm test","CAN bus logs?"],"primary":0}', "sentence"), {
    primary: "Could you check?", choices: ["Could you check?", "npm test", "CAN bus logs?"],
  })
})
