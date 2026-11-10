import type { ReactNode } from 'react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'

export function EmptyState(props: { title: string; children?: ReactNode }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle className="text-base">{props.title}</EmptyTitle>
        {props.children !== undefined && (
          <EmptyDescription>{props.children}</EmptyDescription>
        )}
      </EmptyHeader>
    </Empty>
  )
}
