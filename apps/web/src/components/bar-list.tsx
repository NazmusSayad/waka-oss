import { Delta } from '@/components/delta'
import { cn } from '@/lib/utils'
import { colorFor } from '@/utils/colors'
import { formatDuration, formatPercent, label } from '@/utils/format'

export type BarItem = {
  key: string | null
  seconds: number
  previous: number | null
}

export function BarList(props: {
  items: BarItem[]
  total: number
  limit: number
  onSelect: (key: string | null) => void
}) {
  const visible = props.items.slice(0, props.limit)
  const max = visible[0]?.seconds ?? 0
  if (visible.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        Nothing here
      </p>
    )
  }
  return (
    <ul className="space-y-0.5">
      {visible.map((item) => (
        <li key={item.key ?? '\u0000'}>
          <button
            type="button"
            onClick={() => props.onSelect(item.key)}
            className="group hover:bg-accent focus-visible:ring-ring/50 relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-md opacity-10 group-hover:opacity-20"
              style={{
                width: `${max === 0 ? 0 : (item.seconds / max) * 100}%`,
                background: colorFor(item.key),
              }}
            />
            <span
              className="relative size-2 shrink-0 rounded-full"
              style={{ background: colorFor(item.key) }}
            />
            <span
              className={cn(
                'relative min-w-0 flex-1 truncate',
                item.key === null && 'text-muted-foreground italic'
              )}
            >
              {label(item.key)}
            </span>
            <span className="text-muted-foreground relative w-10 text-right tabular-nums">
              {formatPercent(item.seconds, props.total)}
            </span>
            <span className="relative w-16 text-right tabular-nums">
              {formatDuration(item.seconds)}
            </span>
            {item.previous !== null && (
              <span className="relative w-28 text-right text-[11px] whitespace-nowrap">
                <Delta
                  current={item.seconds}
                  previous={item.previous}
                  format={formatDuration}
                />
              </span>
            )}
          </button>
        </li>
      ))}
      {props.items.length > props.limit && (
        <li className="text-muted-foreground px-2 pt-1 text-[11px]">
          +{props.items.length - props.limit} more ·{' '}
          {formatDuration(
            props.items
              .slice(props.limit)
              .reduce((total, item) => total + item.seconds, 0)
          )}
        </li>
      )}
    </ul>
  )
}
