import { localTime } from './time.ts'

export function computeParallel(heartbeats: [number, number][], from: string, to: string) {
  const events: [number, number][] = []
  for (const [time, laneDuration] of heartbeats) {
    events.push([time, 1], [time + laneDuration, -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const hours = new Map<string, { date: string; hour: number } & ParallelHour>()
  const levels = new Map<number, number>()
  let active = 0
  let previous = 0
  let slot = Number.NEGATIVE_INFINITY
  let local = { date: '', hour: 0 }
  for (const [time, delta] of events) {
    if (active > 0 && time > previous) {
      const currentSlot = Math.floor(previous / 900)
      if (currentSlot !== slot) {
        slot = currentSlot
        local = localTime(slot * 900)
      }
      if (local.date >= from && local.date <= to) {
        const seconds = time - previous
        const key = `${local.date} ${String(local.hour).padStart(2, '0')}`
        const hour = hours.get(key) ?? {
          date: local.date,
          hour: local.hour,
          wall_seconds: 0,
          lane_seconds: 0,
          parallel_seconds: 0,
          peak_lanes: 0,
        }
        hour.wall_seconds += seconds
        hour.lane_seconds += seconds * active
        if (active > 1) {
          hour.parallel_seconds += seconds
        }
        hour.peak_lanes = Math.max(hour.peak_lanes, active)
        hours.set(key, hour)
        levels.set(active, (levels.get(active) ?? 0) + seconds)
      }
    }
    active += delta
    previous = time
  }

  return {
    hours: [...hours.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, hour]) => hour),
    levels: [...levels.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([lanes, seconds]) => ({ lanes, seconds })),
  }
}

type ParallelHour = {
  wall_seconds: number
  lane_seconds: number
  parallel_seconds: number
  peak_lanes: number
}
