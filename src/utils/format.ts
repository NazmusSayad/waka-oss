export function label(value: string | null) {
  return value === null ? 'Unknown' : value
}

export function formatDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60)
  if (totalMinutes === 0) {
    return seconds > 0 ? '<1m' : '0m'
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) {
    return `${minutes}m`
  }
  return `${hours}h ${minutes}m`
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 100000 ? 'compact' : 'standard',
  }).format(Math.round(value))
}

export function formatPercent(part: number, total: number) {
  if (total === 0) {
    return '0%'
  }
  const percent = (part / total) * 100
  return `${percent < 10 && percent > 0 ? percent.toFixed(1) : Math.round(percent)}%`
}
