import type { SessionMessageInfo } from "@opencode/client/promise"
import type { Prediction } from "./model"

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
