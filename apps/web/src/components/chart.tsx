import {
  BarChart,
  CustomChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  TreemapChart,
} from 'echarts/charts'
import {
  CalendarComponent,
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import type { ECElementEvent, EChartsCoreOption } from 'echarts/core'
import { LegacyGridContainLabel } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import { chartPalette, cssColor } from '@/utils/colors'

echarts.use([
  BarChart,
  CustomChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  TreemapChart,
  CalendarComponent,
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  LegacyGridContainLabel,
  CanvasRenderer,
])

function chartTheme() {
  const axis = {
    axisLine: { lineStyle: { color: cssColor('--input') } },
    axisTick: { show: false },
    axisLabel: { color: cssColor('--muted-foreground'), fontSize: 11 },
    splitLine: { lineStyle: { color: cssColor('--border') } },
  }
  return {
    color: chartPalette(),
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: getComputedStyle(document.body).fontFamily,
      color: cssColor('--foreground'),
    },
    animationDuration: 300,
    animationDurationUpdate: 200,
    legend: {
      textStyle: { color: cssColor('--muted-foreground'), fontSize: 11 },
      pageTextStyle: { color: cssColor('--muted-foreground') },
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
    },
    tooltip: {
      backgroundColor: cssColor('--popover'),
      borderColor: cssColor('--border'),
      textStyle: { color: cssColor('--popover-foreground'), fontSize: 12 },
      extraCssText:
        'box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); border-radius: calc(var(--radius) - 2px);',
    },
    categoryAxis: axis,
    valueAxis: axis,
    timeAxis: axis,
  }
}

export function Chart(props: {
  option: EChartsCoreOption
  height: number
  onClick?: (event: ECElementEvent) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }
    const chart = echarts.init(container, chartTheme())
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(props.option, { notMerge: true })
  }, [props.option])

  useEffect(() => {
    const chart = chartRef.current
    const onClick = props.onClick
    if (chart === null || onClick === undefined) {
      return
    }
    chart.on('click', onClick)
    return () => {
      chart.off('click', onClick)
    }
  }, [props.onClick])

  return (
    <div
      ref={containerRef}
      style={{ height: props.height }}
      className="w-full"
    />
  )
}
