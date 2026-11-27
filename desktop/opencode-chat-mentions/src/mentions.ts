import type { SessionMessageInfo } from "@opencode/client"

const mention = /(?<![\w/:@-])@session:(ses_[A-Za-z0-9]{26})(?![\w/-])/g

type RequestMessage = {
  readonly role: string
  readonly content: string | readonly { readonly type: string; readonly text?: unknown }[]
}

export function mentionedSessionIDs(messages: readonly (RequestMessage | SessionMessageInfo)[], currentSessionID: string) {
  const ids = new Set<string>()
  function scan(text: string) {
    for (const match of text.matchAll(mention)) {
      if (match[1] !== currentSessionID) ids.add(match[1])
    }
  }

  for (const message of messages) {
    if (!("role" in message)) {
      if (message.type === "user") scan(message.text)
    } else if (message.role === "user") {
      if (typeof message.content === "string") scan(message.content)
      else for (const part of message.content) {
        if (part.type === "text" && typeof part.text === "string") scan(part.text)
      }
    }
  }
  return ids
}
