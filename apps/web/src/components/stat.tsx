import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

export function Stat(props: {
  label: string
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <Card className="min-w-0 gap-1 px-4 py-3 shadow-none">
      <div className="text-muted-foreground text-xs">{props.label}</div>
      <div className="truncate text-xl font-semibold tabular-nums">
        {props.value}
      </div>
      {props.detail !== undefined && (
        <div className="text-muted-foreground text-xs">{props.detail}</div>
      )}
    </Card>
  )
}

export function StatGrid(props: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
      {props.children}
    </div>
  )
}
