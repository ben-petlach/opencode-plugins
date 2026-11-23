import assert from "node:assert/strict"
import { test } from "node:test"
import { appendQuote, quoteDraft, MAX_QUOTE_LENGTH } from "../src/selection-text.ts"
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

test("appendQuote replaces an empty or whitespace-only draft with the quote", () => {
  assert.equal(appendQuote("", "selected"), "> selected\n\n")
  assert.equal(appendQuote(" \n\t ", "selected"), "> selected\n\n")
})

test("appendQuote preserves draft text and separates it from the quote with one blank line", () => {
  const expected = "  existing draft  \n\n> selected\n\n"
  assert.equal(appendQuote("  existing draft  ", "selected"), expected)
  assert.equal(appendQuote("  existing draft  \n\n\n", "selected"), expected)
  assert.equal(appendQuote("existing\r\nsecond draft line", "  first\r\n    second"), "existing\r\nsecond draft line\n\n>   first\n>     second\n\n")
})

test("appendQuote rejects blank and oversized selections without returning a replacement", () => {
  assert.equal(appendQuote("existing", ""), undefined)
  assert.equal(appendQuote("existing", " \t\r\n "), undefined)
  assert.equal(appendQuote("existing", "x".repeat(MAX_QUOTE_LENGTH + 1)), undefined)
  assert.equal(appendQuote("", "x".repeat(MAX_QUOTE_LENGTH)), `> ${"x".repeat(MAX_QUOTE_LENGTH)}\n\n`)
})
