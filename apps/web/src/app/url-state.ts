import type { Status } from '@/api/types'
import { dimensions } from '@/constants/dimensions'
import type { Filter, Range } from '@/types/dashboard'
import { addDays } from '@/utils/date'

export const views = [
  { id: 'overview', label: 'Overview' },
  { id: 'explore', label: 'Explore' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'timeline', label: 'Day timeline' },
  { id: 'code', label: 'Code' },
  { id: 'ai', label: 'AI vs human' },
  { id: 'parallel', label: 'Parallel' },
  { id: 'branches', label: 'Branches' },
] as const

export type View = (typeof views)[number]['id']

export const presets = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
] as const

export type Preset = (typeof presets)[number]['id']

const datePattern = /^\d{4}-\d{2}-\d{2}$/

export function readUrl() {
  const params = new URLSearchParams(window.location.search)
  const view = views.find((item) => item.id === params.get('view'))
  const preset = presets.find((item) => item.id === params.get('range'))
  const from = params.get('from')
  const to = params.get('to')
  const customValid =
    from !== null &&
    to !== null &&
    datePattern.test(from) &&
    datePattern.test(to) &&
    from <= to
  const filters: Filter[] = []
  for (const raw of params.getAll('f')) {
    const separator = raw.indexOf('=')
    const name = separator === -1 ? raw : raw.slice(0, separator)
    const dimension = dimensions.find((item) => item === name)
    if (dimension !== undefined) {
      filters.push({
        dimension,
        value: separator === -1 ? null : raw.slice(separator + 1),
      })
    }
  }
  const day = params.get('day')
  return {
    view: view === undefined ? 'overview' : view.id,
    preset:
      preset === undefined || (preset.id === 'custom' && !customValid)
        ? '30d'
        : preset.id,
    customFrom: customValid ? from : '',
    customTo: customValid ? to : '',
    compare: params.get('compare') === '1',
    filters,
    day: day !== null && datePattern.test(day) ? day : null,
  }
}

export function writeUrl(state: {
  view: View
  preset: Preset
  customFrom: string
  customTo: string
  compare: boolean
  filters: Filter[]
  day: string | null
}) {
  const params = new URLSearchParams()
  params.set('view', state.view)
  params.set('range', state.preset)
  if (state.preset === 'custom') {
    params.set('from', state.customFrom)
    params.set('to', state.customTo)
  }
  if (state.compare) {
    params.set('compare', '1')
  }
  for (const filter of state.filters) {
    params.append(
      'f',
      filter.value === null
        ? filter.dimension
        : `${filter.dimension}=${filter.value}`
    )
  }
  if (state.view === 'timeline' && state.day !== null) {
    params.set('day', state.day)
  }
  window.history.replaceState(null, '', `?${params}`)
}

export function resolveRange(
  preset: Preset,
  customFrom: string,
  customTo: string,
  status: Status
): Range {
  const today = status.today
  if (preset === 'today') {
    return { from: today, to: today }
  }
  if (preset === '7d') {
    return { from: addDays(today, -6), to: today }
  }
  if (preset === '30d') {
    return { from: addDays(today, -29), to: today }
  }
  if (preset === 'year') {
    return { from: `${today.slice(0, 4)}-01-01`, to: today }
  }
  if (preset === 'all') {
    return {
      from: status.first_date === null ? today : status.first_date,
      to: today,
    }
  }
  return { from: customFrom, to: customTo }
}
