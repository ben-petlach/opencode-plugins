import assert from "node:assert/strict"
import { test } from "node:test"
import type { ModelInfo } from "@opencode/client"
import { modelOptions, parseModelPreferences } from "../src/models.ts"

const now = Date.UTC(2026, 10, 22)
function model(id: string, extra: Partial<ModelInfo> = {}): ModelInfo {
  return { id, name: id, providerID: "openai", family: "sol", enabled: true,
    time: { released: now - 1000 }, cost: [], ...extra } as ModelInfo
}
const entry = (modelID: string) => ({ providerID: "openai", modelID })
const options = (models: ModelInfo[], prefs: string) => modelOptions(models, parseModelPreferences(prefs), id => id, now)

test("hidden models stay out; explicit shortlist and release defaults match main", () => {
  const models = [model("old", { time: { released: now - 10000 } }), model("latest"),
    model("hidden", { family: "hidden" }), model("shown", { time: { released: 1 } }),
    model("disabled", { enabled: false })]
  const prefs = JSON.stringify({ user: [{ ...entry("hidden"), visibility: "hide" }, { ...entry("shown"), visibility: "show" }] })
  assert.deepEqual(options(models, prefs).map(x => x.value), ["openai/latest", "openai/shown"])
})

test("favorites then recent retain order, deduplicate, and skip unavailable models", () => {
  const prefs = JSON.stringify({ favorite: [entry("b"), entry("a"), entry("missing")], recent: [entry("a"), entry("c"), entry("disabled")] })
  const result = options([model("a"), model("b"), model("c"), model("disabled", { enabled: false })], prefs)
  assert.deepEqual(result.map(x => [x.group, x.value]), [["Favorites", "openai/b"], ["Favorites", "openai/a"], ["Recent", "openai/c"]])
})

test("fresh preferences update shortlist without copying or caching settings", () => {
  const models = [model("a")]
  assert.equal(options(models, JSON.stringify({ user: [{ ...entry("a"), visibility: "hide" }] })).length, 0)
  assert.equal(options(models, JSON.stringify({ user: [{ ...entry("a"), visibility: "show" }] })).length, 1)
})

test("free and unknown-date models remain visible; malformed preferences reject", () => {
  const models = [model("free", { providerID: "opencode", time: { released: 1 } }), model("undated", { time: { released: NaN } })]
  assert.equal(options(models, "{}").length, 2)
  assert.throws(() => parseModelPreferences('{"favorite":[{"providerID":4}]}'))
})
