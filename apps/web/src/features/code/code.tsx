import { useMemo } from 'react'
import type { ActivityRow, DependencyRow, FileRow } from '@/api/types'
import { Chart } from '@/components/chart'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { Stat, StatGrid } from '@/components/stat'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { UnappliedFilters } from '@/components/unapplied-filters'
import type { Dimension } from '@/constants/dimensions'
import { codeCharts } from '@/features/code/utils/code-charts'
import type { Filter } from '@/types/dashboard'
import { groupSum, sortedEntries, sum } from '@/utils/aggregate'
import { colorFor } from '@/utils/colors'
import {
  formatDuration,
  formatNumber,
  formatPercent,
  label,
} from '@/utils/format'

export function Code(props: {
  rows: ActivityRow[]
  files: FileRow[]
  dependencies: DependencyRow[]
  filters: Filter[]
  onFilter: (dimension: Dimension, value: string | null) => void
}) {
  const code = useMemo(
    () => codeCharts(props.rows, props.files),
    [props.rows, props.files]
  )

  const mostEdited = useMemo(
    () =>
      [...props.files]
        .filter(
          (file) =>
            file.writes > 0 || file.human_lines !== 0 || file.ai_lines !== 0
        )
        .sort(
          (a, b) =>
            b.writes - a.writes ||
            Math.abs(b.human_lines) +
              Math.abs(b.ai_lines) -
              (Math.abs(a.human_lines) + Math.abs(a.ai_lines))
        )
        .slice(0, 15),
    [props.files]
  )

  const dependencyProjects = useMemo(
    () =>
      sortedEntries(
        groupSum(
          props.dependencies,
          (dependency) => dependency.project,
          (dependency) => dependency.seconds
        )
      )
        .slice(0, 6)
        .map((entry) => {
          const dependencies = props.dependencies
            .filter((dependency) => dependency.project === entry[0])
            .sort((a, b) => b.seconds - a.seconds)
          return {
            project: entry[0],
            count: dependencies.length,
            top: dependencies.slice(0, 8),
          }
        }),
    [props.dependencies]
  )

  if (props.files.length === 0 && props.rows.length === 0) {
    return (
      <EmptyState title="No activity in this range">
        Try a longer range or remove some filters.
      </EmptyState>
    )
  }

  const writes = sum(props.rows, (row) => row.writes)
  const codedSeconds = sum(props.rows, (row) => row.seconds)
  const humanLines = sum(props.rows, (row) => row.human_lines)
  const aiLines = sum(props.rows, (row) => row.ai_lines)
  const fileSeconds = code.editedSeconds + code.readSeconds

  return (
    <div className="space-y-4">
      <UnappliedFilters
        filters={props.filters}
        supported={['project', 'language']}
        source="Files"
      />
      <UnappliedFilters
        filters={props.filters}
        supported={['project']}
        source="Dependencies"
      />

      <StatGrid>
        <Stat
          label="Files touched"
          value={formatNumber(
            props.files.filter((file) => file.type === 'file').length
          )}
          detail={`${code.tree.roots.length} projects`}
        />
        <Stat
          label="Edited vs only read"
          value={`${formatPercent(code.editedSeconds, fileSeconds)} · ${formatPercent(code.readSeconds, fileSeconds)}`}
          detail={`${formatDuration(code.editedSeconds)} in edited files · ${formatDuration(code.readSeconds)} read-only`}
        />
        <Stat
          label="Saves"
          value={formatNumber(writes)}
          detail={`${codedSeconds === 0 ? 0 : (writes / (codedSeconds / 3600)).toFixed(1)} per coding hour`}
        />
        <Stat
          label="Line changes"
          value={formatNumber(humanLines + aiLines)}
          detail={`${formatNumber(humanLines)} human · ${formatNumber(aiLines)} AI`}
        />
      </StatGrid>

      <Panel
        title="Time per folder and file"
        description="Click a block to zoom in; use the breadcrumb to go back"
      >
        {code.tree.roots.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-xs">
            No files in this range
          </p>
        ) : (
          <Chart option={code.treemap} height={480} />
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Writing vs reading"
          description="Time in files you saved at least once vs files you only read, by language"
        >
          <Chart option={code.readingWriting} height={code.sideHeight} />
        </Panel>
        <Panel
          title="Line changes by project"
          description="Human vs AI line changes · click to filter"
        >
          {code.lineProjects.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">
              No line changes recorded
            </p>
          ) : (
            <Chart
              option={code.lines}
              height={code.sideHeight}
              onClick={(event) => {
                const project = code.lineProjects[event.dataIndex]
                if (project !== undefined) {
                  props.onFilter('project', project)
                }
              }}
            />
          )}
        </Panel>
      </div>

      <Panel title="Most edited files" description="By number of saves">
        {mostEdited.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-xs">
            No saved files in this range
          </p>
        ) : (
          <Table className="table-fixed text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="w-40">Project</TableHead>
                <TableHead className="w-28">Language</TableHead>
                <TableHead className="w-20 text-right">Time</TableHead>
                <TableHead className="w-16 text-right">Saves</TableHead>
                <TableHead className="w-20 text-right">Human</TableHead>
                <TableHead className="w-16 text-right">AI</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {mostEdited.map((file) => (
                <TableRow
                  key={`${file.project}:${file.entity}:${file.type}:${file.language}`}
                >
                  <TableCell className="truncate" title={file.entity}>
                    {code.tree.relativePaths.get(file) ?? file.entity}
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate">
                    <button
                      type="button"
                      onClick={() => props.onFilter('project', file.project)}
                      className="hover:text-foreground hover:underline"
                    >
                      {label(file.project)}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate">
                    <button
                      type="button"
                      onClick={() => props.onFilter('language', file.language)}
                      className="hover:text-foreground hover:underline"
                    >
                      {label(file.language)}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatDuration(file.seconds)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(file.writes)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(file.human_lines)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(file.ai_lines)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel
        title="Dependencies by project"
        description="Time in files that import each dependency"
      >
        {dependencyProjects.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-xs">
            No dependencies detected in this range
          </p>
        ) : (
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
            {dependencyProjects.map((group) => {
              const max = group.top[0]?.seconds ?? 0
              return (
                <div key={group.project ?? '\u0000'}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => props.onFilter('project', group.project)}
                      className="truncate text-xs font-medium hover:underline"
                    >
                      {label(group.project)}
                    </button>
                    <span className="text-muted-foreground text-[11px]">
                      {group.count} dependencies
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {group.top.map((dependency) => (
                      <li
                        key={dependency.dependency}
                        className="relative flex items-center justify-between gap-2 px-1.5 py-0.5 text-xs"
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded-sm opacity-20"
                          style={{
                            width: `${max === 0 ? 0 : (dependency.seconds / max) * 100}%`,
                            background: colorFor(group.project),
                          }}
                        />
                        <span className="relative truncate">
                          {dependency.dependency}
                        </span>
                        <span className="text-muted-foreground relative tabular-nums">
                          {formatDuration(dependency.seconds)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}
