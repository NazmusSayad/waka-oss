import type { ReactNode } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function Panel(props: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Card className="min-w-0 gap-4 py-4 shadow-none">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="text-sm font-medium">{props.title}</CardTitle>
        {props.description !== undefined && (
          <CardDescription className="text-xs">
            {props.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="px-4">{props.children}</CardContent>
    </Card>
  )
}
