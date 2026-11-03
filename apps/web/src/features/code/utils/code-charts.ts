import type { ActivityRow, FileRow } from '@/api/types'
import { buildTree } from '@/features/code/utils/build-tree'
import { groupSum, sortedEntries, sum } from '@/utils/aggregate'
import { cssColor } from '@/utils/colors'
import { formatDuration, formatNumber, label } from '@/utils/format'
import { hoursAxis } from '@/utils/hours-axis'

export function codeCharts(rows: ActivityRow[], files: FileRow[]) {
  const tree = buildTree(files)
  const treemap = {
    tooltip: {
      formatter: (params: {
        treePathInfo: { name: string }[]
        value: number
      }) =>
        `${params.treePathInfo
          .slice(1)
          .map((item) => item.name)
          .join('/')}<br/><b>${formatDuration(params.value)}</b>`,
    },
    series: [
      {
        type: 'treemap',
        name: 'All projects',
        data: tree.roots,
        left: 0,
        right: 0,
        top: 0,
        bottom: 28,
        roam: false,
        leafDepth: 3,
        visibleMin: 200,
        nodeClick: 'zoomToNode',
        drillDownIcon: '▸',
        breadcrumb: {
          bottom: 0,
          left: 0,
          itemStyle: {
            color: cssColor('--secondary'),
            borderColor: cssColor('--border'),
            textStyle: { color: cssColor('--secondary-foreground') },
          },
          emphasis: { itemStyle: { color: cssColor('--accent') } },
        },
        label: { color: cssColor('--foreground'), fontSize: 11 },
        upperLabel: {
          show: true,
          height: 20,
          color: cssColor('--foreground'),
          fontSize: 11,
        },
        levels: [
          {
            itemStyle: {
              borderColor: cssColor('--card'),
              borderWidth: 0,
              gapWidth: 3,
            },
            upperLabel: { show: false },
          },
          {
            itemStyle: {
              borderColor: cssColor('--card'),
              borderWidth: 3,
              gapWidth: 1,
            },
            colorAlpha: [0.45, 0.8],
          },
          {
            itemStyle: {
              borderColor: cssColor('--card'),
              borderWidth: 2,
              gapWidth: 1,
            },
            colorAlpha: [0.4, 0.75],
          },
          {
            itemStyle: {
              borderColor: cssColor('--card'),
              borderWidth: 1,
              gapWidth: 1,
            },
            colorAlpha: [0.35, 0.7],
          },
        ],
      },
    ],
  }

  const fileTypeFiles = files.filter((file) => file.type === 'file')
  const editedFiles = fileTypeFiles.filter((file) => file.writes > 0)
  const languages = sortedEntries(
    groupSum(
      fileTypeFiles,
      (file) => file.language,
      (file) => file.seconds
    )
  ).slice(0, 10)
  const editedByLanguage = groupSum(
    editedFiles,
    (file) => file.language,
    (file) => file.seconds
  )
  const readingWriting = {
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value: number) => formatDuration(value),
    },
    xAxis: hoursAxis(Math.max(0, ...languages.map((entry) => entry[1]))),
    yAxis: {
      type: 'category',
      inverse: true,
      data: languages.map((entry) => label(entry[0])),
    },
    series: [
      {
        type: 'bar',
        stack: 'time',
        name: 'Files you edited',
        color: cssColor('--chart-2'),
        barMaxWidth: 16,
        data: languages.map((entry) => editedByLanguage.get(entry[0]) ?? 0),
      },
      {
        type: 'bar',
        stack: 'time',
        name: 'Files you only read',
        color: cssColor('--chart-1'),
        barMaxWidth: 16,
        data: languages.map(
          (entry) => entry[1] - (editedByLanguage.get(entry[0]) ?? 0)
        ),
      },
    ],
  }

  const human = groupSum(
    rows,
    (row) => row.project,
    (row) => row.human_lines
  )
  const ai = groupSum(
    rows,
    (row) => row.project,
    (row) => row.ai_lines
  )
  const lineProjects = sortedEntries(
    groupSum(
      rows,
      (row) => row.project,
      (row) => Math.abs(row.human_lines) + Math.abs(row.ai_lines)
    )
  )
    .filter((entry) => entry[1] > 0)
    .slice(0, 10)
    .map((entry) => entry[0])
  const lines = {
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value: number) => `${formatNumber(value)} lines`,
    },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', inverse: true, data: lineProjects.map(label) },
    series: [
      {
        type: 'bar',
        stack: 'lines',
        name: 'Human',
        color: cssColor('--chart-1'),
        barMaxWidth: 16,
        data: lineProjects.map((project) => human.get(project) ?? 0),
      },
      {
        type: 'bar',
        stack: 'lines',
        name: 'AI',
        color: cssColor('--chart-3'),
        barMaxWidth: 16,
        data: lineProjects.map((project) => ai.get(project) ?? 0),
      },
    ],
  }

  return {
    tree,
    treemap,
    readingWriting,
    lines,
    lineProjects,
    sideHeight: Math.max(
      220,
      Math.max(languages.length, lineProjects.length) * 28 + 40
    ),
    editedSeconds: sum(editedFiles, (file) => file.seconds),
    readSeconds: sum(
      fileTypeFiles.filter((file) => file.writes === 0),
      (file) => file.seconds
    ),
  }
}
