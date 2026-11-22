import { parseFollowUps, type Prediction } from "./model"

// One request per routed window; stale or cancelled replies never replace newer results.
export function createSuggestions(publish: (prediction: Prediction | undefined) => void, report: (error: unknown) => void) {
  let active: AbortController | undefined
  const clear = () => {
    active?.abort()
    active = undefined
    publish(undefined)
  }
  return {
    clear,
    async run(generate: (signal: AbortSignal) => Promise<{ text: string }>, eligible: () => boolean, openingCase?: Parameters<typeof parseFollowUps>[1]) {
      clear()
      if (!eligible()) return
      const current = new AbortController()
      active = current
      const timer = setTimeout(() => current.abort(), 30_000)
      try {
        const result = await generate(current.signal)
        if (!current.signal.aborted && active === current && eligible()) publish(parseFollowUps(result.text, openingCase))
      } catch (error) {
        if (!current.signal.aborted) report(error)
      } finally {
        clearTimeout(timer)
        if (active === current) active = undefined
      }
    },
  }
}
