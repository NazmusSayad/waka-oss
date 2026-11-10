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
  version: string
) {
  const [loaded, setLoaded] = useState<{
    key: string
    data: ParallelData
  } | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)
  const query = `from=${range.from}&to=${range.to}&filters=${encodeURIComponent(JSON.stringify(filters))}&v=${version}`

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await getJson<ParallelData>(
          `/api/parallel?${query}`,
          controller.signal
        )
        setLoaded({ key: query, data })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setFailure({
          key: query,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    void load()
    return () => controller.abort()
  }, [query])

  return {
    data: loaded === null ? null : loaded.data,
    current: loaded?.key === query,
    error: failure?.key === query ? failure.message : null,
  }
}
