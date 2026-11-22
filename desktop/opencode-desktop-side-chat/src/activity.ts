import type { Data } from "@opencode/client/solid"

// shortcut: Desktop 2.3.2 has no activity hook; its native indicators group work through this root lookup.
export function installSideChatActivity(data: Data) {
  const original = data.session.root
  const root = (sessionID: string) => {
    const id = original(sessionID)
    const parentID = data.session.get(id)?.metadata?.desktopSideChatParent
    return typeof parentID === "string" && parentID && parentID !== id ? original(parentID) : id
  }
  data.session.root = root
  return () => {
    if (data.session.root === root) data.session.root = original
  }
}
