import { Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { idleTimeouts } from '@/constants/idle-timeouts'

type Props = {
  idleTimeoutMinutes: number
  onSaved: () => void
}

export function Settings(props: Props) {
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = Number(minutes)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idle_timeout_minutes: value }),
      })
      if (!response.ok) {
        throw new Error(
          `Saving failed: ${response.status} ${await response.text()}`
        )
      }
      setOpen(false)
      props.onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (saving) {
          return
        }
        setOpen(next)
        setMinutes(String(props.idleTimeoutMinutes))
        setError(null)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Settings">
          <SettingsIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <PopoverHeader>
          <PopoverTitle>Idle timeout</PopoverTitle>
          <PopoverDescription className="text-xs">
            A gap longer than this between heartbeats ends a session and is not
            counted as time.
          </PopoverDescription>
        </PopoverHeader>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="idle-timeout" className="text-xs">
              Timeout
            </Label>
            <Select
              value={minutes}
              onValueChange={setMinutes}
              disabled={saving}
            >
              <SelectTrigger id="idle-timeout" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {idleTimeouts.map((timeout) => (
                  <SelectItem key={timeout} value={String(timeout)}>
                    {timeoutLabel(timeout)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={saving || value === props.idleTimeoutMinutes}
          >
            {saving && <Spinner />}
            Save
          </Button>
        </form>
        {error !== null && <p className="text-destructive text-xs">{error}</p>}
      </PopoverContent>
    </Popover>
  )
}

function timeoutLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) {
    return `${rest}m`
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
