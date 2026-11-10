import type { ActivityRow } from '@/api/types'
import { dimensions, type Dimension } from '@/constants/dimensions'
import type { Filter } from '@/types/dashboard'

function passes(
  filters: Filter[],
  dimension: Dimension,
  values: (string | null)[]
) {
  const selected = filters.filter((filter) => filter.dimension === dimension)
  return (
    selected.length === 0 ||
    selected.some((filter) => values.includes(filter.value))
  )
}

export function matchesFilters(
  filters: Filter[],
  record: Partial<Record<Dimension, (string | null)[]>>
) {
  for (const filter of filters) {
    const values = record[filter.dimension]
    if (values !== undefined && !passes(filters, filter.dimension, values)) {
      return false
    }
  }
  return true
}

export function applyFilters(rows: ActivityRow[], filters: Filter[]) {
  if (filters.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    dimensions.every((dimension) =>
      passes(filters, dimension, [row[dimension]])
    )
  )
}
