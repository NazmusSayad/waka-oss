import type { ReactNode } from 'react'

export function Stat(props: {
  label: string
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <div className="bg-card flex min-w-0 flex-col gap-1.5 px-5 py-4">
      <div className="text-muted-foreground text-xs">{props.label}</div>
      <div className="truncate text-2xl font-semibold tracking-tight tabular-nums">
        {props.value}
      </div>
      {props.detail !== undefined && (
        <div className="text-muted-foreground text-xs">{props.detail}</div>
      )}
    </div>
  )
}

export function StatGrid(props: { children: ReactNode }) {
  return (
    <div className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
      {props.children}
    </div>
  )
}
