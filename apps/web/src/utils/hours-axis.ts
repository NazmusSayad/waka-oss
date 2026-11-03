const hourSteps = [
  300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200, 86400, 172800,
  432000, 864000, 1728000, 3600000,
]

function formatHoursAxis(seconds: number) {
  const hours = seconds / 3600
  if (hours === 0) {
    return '0'
  }
  if (hours < 1) {
    return `${Math.round(seconds / 60)}m`
  }
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

export function hoursAxis(maxSeconds: number) {
  return {
    type: 'value',
    interval: hourSteps.find((step) => maxSeconds / step <= 5),
    axisLabel: { formatter: formatHoursAxis },
  }
}
