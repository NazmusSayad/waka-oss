import { useEffect, useState } from 'react'
import { getJson } from '@/api/get-json'
import type { ParallelHour, ParallelLevel } from '@/api/types'
import type { Filter, Range } from '@/types/dashboard'

type ParallelData = {
  hours: ParallelHour[]
  levels: ParallelLevel[]
}

export function useParallel(
  range: Range,
  filters: Filter[],
  serverTime: number
) {
  const [loaded, setLoaded] = useState<{
    key: string
    data: ParallelData
  } | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)
  const query = `from=${range.from}&to=${range.to}&filters=${encodeURIComponent(JSON.stringify(filters))}`
  const key = `${query}|${serverTime}`

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await getJson<ParallelData>(
          `/api/parallel?${query}`,
          controller.signal
        )
        setLoaded({ key, data })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setFailure({
          key,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    void load()
    return () => controller.abort()
  }, [query, key])

  return {
    data: loaded === null ? null : loaded.data,
    current: loaded?.key === key,
    error: failure?.key === key ? failure.message : null,
  }
}
