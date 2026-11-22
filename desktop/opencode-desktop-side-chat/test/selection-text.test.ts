import assert from "node:assert/strict"
import { test } from "node:test"
import { quoteDraft, MAX_QUOTE_LENGTH } from "../src/selection-text.ts"
test("selected commands and multiline code remain quoted, with a blank question line", () => {
  assert.equal(quoteDraft('/sidechat-new\n```js\nconst a = 1\n```'), '> /sidechat-new\n> ```js\n> const a = 1\n> ```\n\n')
})
test("quote retains selected indentation and normalizes Windows line breaks", () => {
  assert.equal(quoteDraft('  selected\r\n    text'), '>   selected\n>     text\n\n')
})
test("empty and oversized selections cannot create empty or silently truncated chats", () => {
  assert.equal(quoteDraft(' \n '), undefined)
  assert.equal(quoteDraft('a'.repeat(MAX_QUOTE_LENGTH + 1)), undefined)
  assert.ok(quoteDraft('a'.repeat(MAX_QUOTE_LENGTH)))
})
