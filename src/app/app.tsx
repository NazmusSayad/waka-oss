import { CircleAlert, LogOut, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getJson } from '@/api/get-json'
import type {
  ActivityRow,
  DependencyRow,
  FileRow,
  Session,
  Status,
} from '@/api/types'
import {
  presets,
  readUrl,
  resolveRange,
  views,
  writeUrl,
} from '@/app/url-state'
import { DatePicker } from '@/components/date-picker'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { dimensionLabels, type Dimension } from '@/constants/dimensions'
import { AiVsHuman } from '@/features/ai-vs-human'
import { Branches } from '@/features/branches'
import { Code } from '@/features/code'
import { DayTimeline } from '@/features/day-timeline'
import { Explore } from '@/features/explore'
import { Overview } from '@/features/overview'
import { Parallel } from '@/features/parallel'
import { Patterns } from '@/features/patterns'
import { Settings } from '@/features/settings'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import type { Range } from '@/types/dashboard'
import { addDays, formatRange, previousRange } from '@/utils/date'
import { applyFilters, matchesFilters } from '@/utils/filters'
import { label } from '@/utils/format'

type Loaded = {
  key: string
  status: Status
  range: Range
  previous: Range
  rows: ActivityRow[]
  previousRows: ActivityRow[]
  recentRows: ActivityRow[]
  sessions: Session[]
  files: FileRow[]
  dependencies: DependencyRow[]
}

const initial = readUrl()

export function App() {
  const [view, setView] = useState(initial.view)
  const [preset, setPreset] = useState(initial.preset)
  const [customFrom, setCustomFrom] = useState(initial.customFrom)
  const [customTo, setCustomTo] = useState(initial.customTo)
  const [compare, setCompare] = useState(initial.compare)
  const [filters, setFilters] = useState(initial.filters)
  const [day, setDay] = useState(initial.day)
  const [reloadCount, setReloadCount] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)

  const requestKey = `${preset}|${customFrom}|${customTo}|${reloadCount}`

  useEffect(() => {
    const controller = new AbortController()
    const key = `${preset}|${customFrom}|${customTo}|${reloadCount}`
    async function load() {
      try {
        const status = await getJson<Status>('/api/status', controller.signal)
        const range = resolveRange(preset, customFrom, customTo, status)
        const previous = previousRange(range)
        const version = `v=${status.version}`
        const query = `from=${range.from}&to=${range.to}&${version}`
        const responses = await Promise.all([
          getJson<{ rows: ActivityRow[] }>(
            `/api/activity?${query}`,
            controller.signal
          ),
          getJson<{ rows: ActivityRow[] }>(
            `/api/activity?from=${previous.from}&to=${previous.to}&${version}`,
            controller.signal
          ),
          getJson<{ rows: ActivityRow[] }>(
            `/api/activity?from=${addDays(status.today, -59)}&to=${status.today}&${version}`,
            controller.signal
          ),
          getJson<{ sessions: Session[] }>(
            `/api/sessions?${query}`,
            controller.signal
          ),
          getJson<{ rows: FileRow[] }>(
            `/api/files?${query}`,
            controller.signal
          ),
          getJson<{ rows: DependencyRow[] }>(
            `/api/dependencies?${query}`,
            controller.signal
          ),
        ])
        setLoaded({
          key,
          status,
          range,
          previous,
          rows: responses[0].rows,
          previousRows: responses[1].rows,
          recentRows: responses[2].rows,
          sessions: responses[3].sessions,
          files: responses[4].rows,
          dependencies: responses[5].rows,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setFailure({
          key,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    void load()
    return () => controller.abort()
  }, [preset, customFrom, customTo, reloadCount])

  useEffect(() => {
    writeUrl({ view, preset, customFrom, customTo, compare, filters, day })
  }, [view, preset, customFrom, customTo, compare, filters, day])

  const filtered = useMemo(() => {
    if (loaded === null) {
      return null
    }
    return {
      rows: applyFilters(loaded.rows, filters),
      previousRows: applyFilters(loaded.previousRows, filters),
      recentRows: applyFilters(loaded.recentRows, filters),
      sessions: loaded.sessions.filter((session) =>
        matchesFilters(filters, {
          project: session.projects,
          language: session.languages,
        })
      ),
      files: loaded.files.filter((file) =>
        matchesFilters(filters, {
          project: [file.project],
          language: [file.language],
        })
      ),
      dependencies: loaded.dependencies.filter((dependency) =>
        matchesFilters(filters, { project: [dependency.project] })
      ),
    }
  }, [loaded, filters])

  const loading = loaded?.key !== requestKey && failure?.key !== requestKey
  const currentFailure = failure?.key === requestKey ? failure : null

  function addFilter(dimension: Dimension, value: string | null) {
    if (
      filters.some(
        (filter) => filter.dimension === dimension && filter.value === value
      )
    ) {
      return
    }
    setFilters([...filters, { dimension, value }])
  }

  function openDay(date: string) {
    setDay(date)
    setView('timeline')
  }

  function selectView(value: string) {
    const next = views.find((item) => item.id === value)
    if (next === undefined) {
      throw new Error(`Unknown view: ${value}`)
    }
    setView(next.id)
  }

  function selectPreset(value: string) {
    if (value === '') {
      return
    }
    const next = presets.find((item) => item.id === value)
    if (next === undefined) {
      throw new Error(`Unknown range preset: ${value}`)
    }
    if (next.id === 'custom' && loaded !== null) {
      setCustomFrom(loaded.range.from)
      setCustomTo(loaded.range.to)
    }
    setPreset(next.id)
  }

  return (
    <TooltipProvider>
      <Tabs
        value={view}
        onValueChange={selectView}
        className="min-h-screen gap-0"
      >
        <header className="bg-background/90 sticky top-0 z-10 border-b backdrop-blur">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <span className="bg-primary size-2.5 rounded-[3px]" />
              waka
            </span>
            <TabsList className="max-w-full overflow-x-auto">
              {views.map((item) => (
                <TabsTrigger key={item.id} value={item.id} className="px-3">
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void fetch('/api/refresh', { method: 'POST' }).finally(() =>
                  setReloadCount((count) => count + 1)
                )
              }}
              disabled={loading}
              className="ml-auto"
            >
              <RefreshCw className={cn(loading && 'animate-spin')} />
              Refresh
            </Button>
            {loaded !== null && (
              <Settings
                idleTimeoutMinutes={loaded.status.idle_timeout_minutes}
                onSaved={() => setReloadCount(reloadCount + 1)}
              />
            )}
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Log out"
              onClick={() => void useAuth.getState().logout()}
            >
              <LogOut />
            </Button>
          </div>
          <div className="border-t">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={preset}
                onValueChange={selectPreset}
              >
                {presets.map((item) => (
                  <ToggleGroupItem
                    key={item.id}
                    value={item.id}
                    className="px-3 text-xs"
                  >
                    {item.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {preset === 'custom' && (
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <DatePicker
                    label="From"
                    value={customFrom}
                    max={customTo}
                    onChange={setCustomFrom}
                  />
                  to
                  <DatePicker
                    label="To"
                    value={customTo}
                    min={customFrom}
                    onChange={setCustomTo}
                  />
                </div>
              )}
              {loaded !== null && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatRange(loaded.range)}
                </span>
              )}
              <div className="flex items-center gap-2">
                <Switch
                  id="compare"
                  size="sm"
                  checked={compare}
                  onCheckedChange={setCompare}
                />
                <Label
                  htmlFor="compare"
                  className="text-muted-foreground text-xs font-normal"
                >
                  Compare with previous period
                  {compare && loaded !== null && (
                    <span className="tabular-nums">
                      ({formatRange(loaded.previous)})
                    </span>
                  )}
                </Label>
              </div>
              {filters.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 lg:ml-auto">
                  {filters.map((filter) => (
                    <Badge
                      key={`${filter.dimension}:${filter.value}`}
                      variant="secondary"
                      className="gap-1 py-0.5 pr-0.5 pl-2"
                    >
                      <span className="text-muted-foreground">
                        {dimensionLabels[filter.dimension]}
                      </span>
                      {label(filter.value)}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Remove filter"
                            onClick={() =>
                              setFilters(
                                filters.filter((item) => item !== filter)
                              )
                            }
                            className="hover:bg-background/60 rounded-full p-0.5"
                          >
                            <X className="size-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Remove filter</TooltipContent>
                      </Tooltip>
                    </Badge>
                  ))}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setFilters([])}
                    className="text-muted-foreground"
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          className={cn(
            'mx-auto w-full max-w-[1440px] px-6 py-5 transition-opacity',
            loading && loaded !== null && 'opacity-60'
          )}
        >
          {currentFailure !== null && (
            <Alert variant="destructive" className="mb-4">
              <CircleAlert />
              <AlertTitle>Couldn’t load data</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                {currentFailure.message}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadCount(reloadCount + 1)}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {loaded === null && currentFailure === null && (
            <div className="space-y-4" aria-label="Loading">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-[86px] rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-[360px] rounded-xl" />
              <div className="grid gap-4 lg:grid-cols-2">
                <Skeleton className="h-[320px] rounded-xl" />
                <Skeleton className="h-[320px] rounded-xl" />
              </div>
            </div>
          )}
          {loaded !== null && loaded.status.first_date === null && (
            <EmptyState title="No heartbeats yet">
              Point wakatime-cli at this server by setting{' '}
              <code className="text-foreground">
                api_url = {window.location.origin}/api/v1
              </code>{' '}
              in <code className="text-foreground">~/.wakatime.cfg</code>, then
              write some code.
            </EmptyState>
          )}
          {loaded !== null &&
            filtered !== null &&
            loaded.status.first_date !== null && (
              <>
                <TabsContent value="overview">
                  <Overview
                    status={loaded.status}
                    rows={filtered.rows}
                    previousRows={filtered.previousRows}
                    recentRows={filtered.recentRows}
                    range={loaded.range}
                    compare={compare}
                    filters={filters}
                    onFilter={addFilter}
                    onOpenDay={openDay}
                  />
                </TabsContent>
                <TabsContent value="explore">
                  <Explore
                    rows={filtered.rows}
                    previousRows={filtered.previousRows}
                    range={loaded.range}
                    compare={compare}
                    onFilter={addFilter}
                  />
                </TabsContent>
                <TabsContent value="patterns">
                  <Patterns
                    status={loaded.status}
                    rows={filtered.rows}
                    sessions={filtered.sessions}
                    range={loaded.range}
                    filters={filters}
                    onOpenDay={openDay}
                  />
                </TabsContent>
                <TabsContent value="timeline">
                  <DayTimeline
                    status={loaded.status}
                    date={day === null ? loaded.range.to : day}
                    onDateChange={setDay}
                    filters={filters}
                    onFilter={addFilter}
                  />
                </TabsContent>
                <TabsContent value="code">
                  <Code
                    rows={filtered.rows}
                    files={filtered.files}
                    dependencies={filtered.dependencies}
                    filters={filters}
                    onFilter={addFilter}
                  />
                </TabsContent>
                <TabsContent value="ai">
                  <AiVsHuman
                    status={loaded.status}
                    rows={filtered.rows}
                    sessions={filtered.sessions}
                    range={loaded.range}
                    filters={filters}
                    onFilter={addFilter}
                  />
                </TabsContent>
                <TabsContent value="parallel">
                  <Parallel
                    status={loaded.status}
                    range={loaded.range}
                    filters={filters}
                    onOpenDay={openDay}
                  />
                </TabsContent>
                <TabsContent value="branches">
                  <Branches
                    rows={filtered.rows}
                    range={loaded.range}
                    onFilter={addFilter}
                  />
                </TabsContent>
              </>
            )}
        </main>
      </Tabs>
    </TooltipProvider>
  )
}
