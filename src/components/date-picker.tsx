import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { formatDate } from '@/utils/date'

function toDate(value: string) {
  return new Date(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10))
  )
}

function toValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function DatePicker(props: {
  label: string
  value: string
  min?: string
  max?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={props.label}
          className="justify-start font-normal tabular-nums"
        >
          <CalendarIcon className="text-muted-foreground" />
          {formatDate(props.value, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          required
          captionLayout="dropdown"
          selected={toDate(props.value)}
          defaultMonth={toDate(props.value)}
          disabled={[
            props.min !== undefined && { before: toDate(props.min) },
            props.max !== undefined && { after: toDate(props.max) },
          ]}
          onSelect={(date) => {
            props.onChange(toValue(date))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
