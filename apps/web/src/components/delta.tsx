import { cn } from '@/lib/utils'
import { formatPercent } from '@/utils/format'

export function Delta(props: {
  current: number
  previous: number
  format: (value: number) => string
}) {
  const difference = props.current - props.previous
  if (difference === 0) {
    return <span className="text-muted-foreground">no change</span>
  }
  const sign = difference > 0 ? '+' : '−'
  return (
    <span
      className={cn(
        'tabular-nums',
        difference > 0 && 'text-emerald-400',
        difference < 0 && 'text-rose-400'
      )}
    >
      {sign}
      {props.format(Math.abs(difference))}
      {props.previous > 0 &&
        ` (${sign}${formatPercent(Math.abs(difference), props.previous)})`}
    </span>
  )
}
