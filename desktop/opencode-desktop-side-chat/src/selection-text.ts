// Match OpenCode's quote length limit. Reject rather than silently shorten selected text.
export const MAX_QUOTE_LENGTH = 20_000
export function quoteDraft(text: string) {
  if (!text.trim() || text.length > MAX_QUOTE_LENGTH) return undefined
  return text.split(/\r?\n/).map(line => `> ${line}`).join("\n") + "\n\n"
}

export function appendQuote(draft: string, text: string): string | undefined {
  const quoted = quoteDraft(text)
  if (quoted === undefined) return undefined
  return draft.trim() ? `${draft.replace(/\n+$/, "")}\n\n${quoted}` : quoted
}
