import type { ActivityRow, Session } from '@/api/types'
import { addDays, secondsIntoDay } from '@/utils/date'

export function sessionTokens(
  sessions: Session[],
  rows: ActivityRow[],
  timeZone: string
) {
  const tokensByHour = new Map<string, { input: number; output: number }>()
  for (const row of rows) {
    if (row.ai_input_tokens === 0 && row.ai_output_tokens === 0) {
      continue
    }
    const key = `${row.date}:${row.hour}`
    const existing = tokensByHour.get(key)
    tokensByHour.set(key, {
      input: (existing?.input ?? 0) + row.ai_input_tokens,
      output: (existing?.output ?? 0) + row.ai_output_tokens,
    })
  }
  const claimed = new Set<string>()
  return [...sessions]
    .sort((a, b) => a.start - b.start)
    .map((session) => {
      const startSeconds = secondsIntoDay(session.start, timeZone)
      const firstHour = Math.floor(startSeconds / 3600)
      const lastHour = Math.floor(
        (startSeconds + (session.end - session.start)) / 3600
      )
      let input = 0
      let output = 0
      for (let hour = firstHour; hour <= lastHour; hour++) {
        const key = `${addDays(session.date, Math.floor(hour / 24))}:${hour % 24}`
        const tokens = tokensByHour.get(key)
        if (tokens === undefined || claimed.has(key)) {
          continue
        }
        claimed.add(key)
        input += tokens.input
        output += tokens.output
      }
      return { session, input, output }
    })
    .filter((item) => item.input + item.output > 0)
    .sort((a, b) => b.input + b.output - (a.input + a.output))
}
