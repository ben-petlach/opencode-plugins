import type { SessionMessageInfo } from "@opencode/client"
import { Contract } from "@opencode/plugin/gui"
import type { Turn } from "./conversation.ts"

export interface Prediction {
  readonly choices: readonly string[]
  readonly primary?: string
}

export interface FollowupsModelRef {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

export interface FollowupsRequest {
  readonly scopeKey: string
  readonly turnID: string
  readonly messages: readonly SessionMessageInfo[]
  readonly generate: (
    prompt: string,
    model: FollowupsModelRef,
    signal: AbortSignal,
  ) => Promise<{ readonly text: string }>
  readonly eligible?: () => boolean
  readonly force?: boolean
}

export interface FollowupsService {
  enabled(): boolean
  acceptKeybind(): readonly string[]
  matchesDraft(choice: string, draft: string): boolean
  get(scopeKey: string, turnID: string): Prediction | undefined
  request(input: FollowupsRequest): void
  cancel(scopeKey: string, options?: { readonly clearCache?: boolean }): void
}

export const FollowupsContract = Contract.define<FollowupsService, "opencode-desktop-followups.suggestions">(
  "opencode-desktop-followups.suggestions",
)

function isTurn(message: SessionMessageInfo): message is Extract<SessionMessageInfo, { type: "idle" | "assistant" | "user" }> {
  return message.type === "idle" || message.type === "assistant" || message.type === "user"
}

export function latestTurn(messages: readonly SessionMessageInfo[]) {
  return messages.findLast(isTurn)
}

export function shouldAutoSuggest(messages: readonly SessionMessageInfo[]): boolean {
  const end = messages.findLastIndex(isTurn)
  const turn = messages[end]
  if (turn?.type !== "idle" || turn.outcome !== "succeeded") return false
  const reply = latestTurn(messages.slice(0, end))
  return reply?.type === "assistant" && reply.content.some(part => part.type === "text" && !!part.text.trim())
}

export function hasAssistantReply(messages: readonly SessionMessageInfo[]): boolean {
  return messages.some(message => message.type === "assistant")
}

export function withLegacyMessages(legacy: readonly Turn[], messages: readonly SessionMessageInfo[]): readonly SessionMessageInfo[] {
  if (!legacy.length) return messages
  return [
    ...legacy.flatMap(({ question, answer }, index): SessionMessageInfo[] => [
      { id: `legacy-user-${index}`, time: { created: 0 }, type: "user", text: question },
      {
        id: `legacy-assistant-${index}`, time: { created: 0 }, type: "assistant",
        agent: "legacy", model: { providerID: "legacy", id: "legacy" }, content: [{ type: "text", text: answer }],
      },
    ]),
    ...messages,
  ]
}

export function filterPrediction(
  prediction: Prediction | undefined,
  draft: string,
  matchesDraft: (choice: string, draft: string) => boolean,
): { primary?: string; choices: string[] } | undefined {
  if (!prediction) return undefined
  const choices = prediction.choices.filter(choice => matchesDraft(choice, draft))
  return prediction.primary && matchesDraft(prediction.primary, draft) ? { primary: prediction.primary, choices } : { choices }
}
