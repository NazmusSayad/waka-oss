import { Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'

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
  const valid =
    minutes !== '' && Number.isInteger(value) && value >= 1 && value <= 120

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
            counted as time. Saving recalculates all past data.
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
              Minutes (1–120)
            </Label>
            <Input
              id="idle-timeout"
              type="number"
              min={1}
              max={120}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              aria-invalid={!valid}
              disabled={saving}
            />
          </div>
          <Button
            type="submit"
            disabled={!valid || saving || value === props.idleTimeoutMinutes}
          >
            {saving ? 'Recalculating…' : 'Save'}
          </Button>
        </form>
        {error !== null && <p className="text-destructive text-xs">{error}</p>}
      </PopoverContent>
    </Popover>
  )
}
