import assert from "node:assert/strict"
import { test } from "node:test"
import { mentionedSessionIDs } from "../src/mentions.ts"

const id = (i: number) => `ses_${i.toString().padStart(26, "A")}`
const mention = (i: number) => `@session:${id(i)}`

test("extracts explicit user mentions from strings, text parts, and stored user messages in first-seen order", () => {
  const actual = mentionedSessionIDs([
    { role: "user", content: `${id(9)} ${mention(2)}, ${mention(1)} ${mention(0)}` },
    { role: "assistant", content: mention(4) },
    { role: "system", content: [{ type: "text", text: mention(5) }] },
    { role: "tool", content: [{ type: "tool-result", text: mention(6) }] },
    { role: "user", content: [
      { type: "media", text: mention(7) },
      { type: "text", text: `(${mention(1)}) ${mention(3)}` },
    ] },
    { type: "user", id: "old", time: { created: 1 }, text: `${mention(2)} ${mention(8)}` },
    { type: "synthetic", id: "background", time: { created: 2 }, text: mention(10) },
  ], id(0))
  assert.deepEqual([...actual], [id(2), id(1), id(3), id(8)])
})

test("rejects malformed tokens, embedded IDs, and mentions split across content parts", () => {
  const actual = mentionedSessionIDs([
    { role: "user", content: [`abc${mention(1)}`, `https://example.com/${mention(2)}`, `@${mention(3)}`,
      `-${mention(4)}`, `${mention(5)}a`, `${mention(6)}-suffix`, `${mention(7)}/x`, "@session:ses_123",
      `@Session:${id(8)}`, id(9)].join(" ") },
    { role: "user", content: [{ type: "text", text: "@session:" }, { type: "text", text: id(10) }] },
  ], id(0))
  assert.equal(actual.size, 0)
})
