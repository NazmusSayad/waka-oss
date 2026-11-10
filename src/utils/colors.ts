const paletteSize = 12

const canvasContext = document
  .createElement('canvas')
  .getContext('2d', { willReadFrequently: true })

const resolvedColors = new Map<string, string>()

export function cssColor(variable: string) {
  const existing = resolvedColors.get(variable)
  if (existing !== undefined) {
    return existing
  }
  if (canvasContext === null) {
    throw new Error('Canvas 2D context is not available')
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim()
  if (value === '') {
    throw new Error(`CSS variable ${variable} is not defined`)
  }
  canvasContext.clearRect(0, 0, 1, 1)
  canvasContext.fillStyle = value
  canvasContext.fillRect(0, 0, 1, 1)
  const pixel = canvasContext.getImageData(0, 0, 1, 1).data
  const alpha = pixel[3]
  if (alpha === undefined) {
    throw new Error(`Could not resolve CSS variable ${variable}`)
  }
  const color = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${alpha / 255})`
  resolvedColors.set(variable, color)
  return color
}

export function chartPalette() {
  return Array.from({ length: paletteSize }, (_, index) =>
    cssColor(`--chart-${index + 1}`)
  )
}

const assignedColors = new Map<string, string>()

export function colorFor(value: string | null) {
  if (value === null) {
    return cssColor('--chart-unknown')
  }
  const existing = assignedColors.get(value)
  if (existing !== undefined) {
    return existing
  }
  const color = cssColor(`--chart-${(assignedColors.size % paletteSize) + 1}`)
  assignedColors.set(value, color)
  return color
}
