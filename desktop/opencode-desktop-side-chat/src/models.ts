import type { ModelInfo } from "@opencode/client"
import { Schema } from "effect"

const Key = Schema.Struct({ providerID: Schema.String, modelID: Schema.String })
const Preferences = Schema.Struct({
  user: Schema.optional(Schema.Array(Schema.Struct({ ...Key.fields, visibility: Schema.Literals(["show", "hide"]) }))),
  favorite: Schema.optional(Schema.Array(Key)),
  recent: Schema.optional(Schema.Array(Key)),
})
export const parseModelPreferences = (raw: string) => Schema.decodeUnknownSync(Schema.fromJsonString(Preferences))(raw)

type Preferences = typeof Preferences.Type
const key = (item: { providerID: string; id: string }) => `${item.providerID}/${item.id}`
const free = (item: ModelInfo) => item.providerID === "opencode" && (!item.cost.length || item.cost[0].input === 0)

// Matches the main picker's visibility defaults and Favorites/Recent precedence in OpenCode 2.3.2.
export function modelOptions(models: readonly ModelInfo[], prefs: Preferences, providerName: (id: string) => string, now = Date.now()) {
  const available = models.filter(item => item.enabled)
  const latest = new Map<string, ModelInfo>()
  for (const item of available) {
    if (Math.abs(now - item.time.released) >= 6 * 30.436875 * 24 * 60 * 60 * 1000 || !Number.isFinite(item.time.released)) continue
    const family = `${item.providerID}:${item.family}:${free(item)}`
    const previous = latest.get(family)
    if (!previous || item.time.released > previous.time.released) latest.set(family, item)
  }
  const defaults = new Set([...latest.values()].map(key))
  const visibility = new Map(prefs.user?.map(item => [`${item.providerID}/${item.modelID}`, item.visibility]))
  const listed = new Set<string>()
  const options: { title: string; description: string; group: string; value: string }[] = []
  function add(item: ModelInfo, group: string) {
    if (listed.has(key(item))) return
    listed.add(key(item))
    options.push({ title: item.name.replace("(latest)", "").trim(), description: item.id, group, value: key(item) })
  }
  for (const [group, entries] of [["Favorites", prefs.favorite], ["Recent", prefs.recent]] as const) {
    for (const entry of entries ?? []) {
      const item = available.find(item => item.providerID === entry.providerID && item.id === entry.modelID)
      if (item) add(item, group)
    }
  }
  for (const item of [...available].sort((a, b) => providerName(a.providerID).localeCompare(providerName(b.providerID)) || a.name.localeCompare(b.name))) {
    const state = visibility.get(key(item))
    if (state === "hide" || (state !== "show" && !defaults.has(key(item)) && !free(item) && Number.isFinite(item.time.released))) continue
    add(item, providerName(item.providerID))
  }
  return options
}
