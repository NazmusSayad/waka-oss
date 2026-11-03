import { Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { dimensionLabels, type Dimension } from '@/constants/dimensions'
import type { Filter } from '@/types/dashboard'

export function UnappliedFilters(props: {
  filters: Filter[]
  supported: Dimension[]
  source: string
}) {
  const unapplied = [
    ...new Set(props.filters.map((filter) => filter.dimension)),
  ].filter((dimension) => !props.supported.includes(dimension))
  if (unapplied.length === 0) {
    return null
  }
  return (
    <Alert className="border-amber-400/30 py-2 text-amber-200">
      <Info />
      <AlertDescription className="text-xs text-amber-200/80">
        {props.source} can’t be filtered by{' '}
        {unapplied
          .map((dimension) => dimensionLabels[dimension].toLowerCase())
          .join(', ')}
        ; those filters are ignored here.
      </AlertDescription>
    </Alert>
  )
}
