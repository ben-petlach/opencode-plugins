type SideTabActivity = {
  running: boolean
  hasActiveWorkers?: boolean
  idle?: number
  viewed?: number
  tabViewedIdle?: number
}

export type SideTabStatus = "working" | "unread" | "idle"

export function isSideTabUnread(input: SideTabActivity): boolean {
  if (input.running || input.hasActiveWorkers || input.idle === undefined) return false
  const seen = input.tabViewedIdle ?? input.viewed ?? -1
  return input.idle > seen
}

export function markSeenIdle(current: number | undefined, idle: number): number {
  return Math.max(current ?? 0, idle)
}

export function sideTabStatus(input: SideTabActivity): SideTabStatus {
  if (input.running || input.hasActiveWorkers) return "working"
  return isSideTabUnread(input) ? "unread" : "idle"
}

export function hasRunningDescendant(
  sessions: readonly { id: string; parentID?: string }[],
  rootID: string,
  isRunning: (id: string) => boolean,
): boolean {
  const children = new Map<string, string[]>()
  for (const { id, parentID } of sessions) {
    if (!parentID) continue
    const siblings = children.get(parentID)
    if (siblings) siblings.push(id)
    else children.set(parentID, [id])
  }
  const seen = new Set([rootID])
  const pending = [...(children.get(rootID) ?? [])]
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    if (isRunning(id)) return true
    for (const child of children.get(id) ?? []) pending.push(child)
  }
  return false
}
