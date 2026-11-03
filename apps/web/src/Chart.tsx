import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, CustomChart, HeatmapChart, LineChart, PieChart, SankeyChart, TreemapChart } from "echarts/charts";
import {
  CalendarComponent,
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ECElementEvent, EChartsCoreOption } from "echarts/core";

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
  CanvasRenderer,
]);

const axis = {
  axisLine: { lineStyle: { color: "#3f3f46" } },
  axisTick: { show: false },
  axisLabel: { color: "#a1a1aa", fontSize: 11 },
  splitLine: { lineStyle: { color: "#27272a" } },
};

echarts.registerTheme("waka", {
  backgroundColor: "transparent",
  textStyle: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", color: "#d4d4d8" },
  animationDuration: 300,
  animationDurationUpdate: 200,
  legend: { textStyle: { color: "#a1a1aa", fontSize: 11 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
  tooltip: {
    backgroundColor: "#18181b",
    borderColor: "#3f3f46",
    textStyle: { color: "#e4e4e7", fontSize: 12 },
    extraCssText: "box-shadow: 0 8px 24px rgba(0,0,0,.4); border-radius: 6px;",
  },
  categoryAxis: axis,
  valueAxis: axis,
  timeAxis: axis,
});

export function Chart(props: { option: EChartsCoreOption; height: number; onClick?: (event: ECElementEvent) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart = echarts.init(container, "waka");
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(props.option, { notMerge: true });
  }, [props.option]);

  useEffect(() => {
    const chart = chartRef.current;
    const onClick = props.onClick;
    if (chart === null || onClick === undefined) {
      return;
    }
    chart.on("click", onClick);
    return () => {
      chart.off("click", onClick);
    };
  }, [props.onClick]);

  return <div ref={containerRef} style={{ height: props.height }} className="w-full" />;
}
