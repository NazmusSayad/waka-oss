import { requiredEnv } from './env.ts'

export const timezone = requiredEnv('TIMEZONE')

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})

export function localTime(seconds: number) {
  const parts = formatter.formatToParts(new Date(seconds * 1000))
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const found = parts.find((item) => item.type === type)
    if (found === undefined) {
      throw new Error(`missing ${type} in formatted date`)
    }
    return found.value
  }
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
  }
}
