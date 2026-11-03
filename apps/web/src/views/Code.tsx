import { useMemo } from "react";
import type { ActivityRow, DependencyRow, FileRow } from "../api";
import { Chart } from "../Chart";
import { colorFor, formatDuration, formatNumber, formatPercent, groupSum, hoursAxis, label, sortedEntries, sum, type Dimension, type Filter } from "../lib";
import { Empty, Panel, Stat, StatStrip, UnappliedFilters } from "../ui";

type TreeNode = { name: string; value: number; children: TreeNode[]; itemStyle?: { color: string } };

function childNamed(node: TreeNode, name: string) {
  const existing = node.children.find((child) => child.name === name);
  if (existing !== undefined) {
    return existing;
  }
  const created: TreeNode = { name, value: 0, children: [] };
  node.children.push(created);
  return created;
}

function splitPath(path: string) {
  return path.split(/[\\/]/).filter((part) => part !== "");
}

function buildTree(files: FileRow[]) {
  const relativePaths = new Map<FileRow, string>();
  const roots: TreeNode[] = [];
  for (const projectEntry of sortedEntries(groupSum(files, (file) => file.project, (file) => file.seconds))) {
    const projectFiles = files.filter((file) => file.project === projectEntry[0] && file.seconds > 0);
    const root: TreeNode = { name: label(projectEntry[0]), value: 0, children: [], itemStyle: { color: colorFor(projectEntry[0]) } };
    const directories = projectFiles.filter((file) => file.type === "file").map((file) => splitPath(file.entity).slice(0, -1));
    const firstDirectory = directories[0] ?? [];
    let prefixLength = firstDirectory.length;
    for (const directory of directories) {
      let index = 0;
      while (index < prefixLength && directory[index] === firstDirectory[index]) {
        index++;
      }
      prefixLength = index;
    }
    for (const file of projectFiles) {
      const parts = file.type === "file" ? splitPath(file.entity).slice(prefixLength) : [`(${label(file.type)})`, file.entity];
      relativePaths.set(file, file.type === "file" ? parts.join("/") : file.entity);
      root.value += file.seconds;
      let node = root;
      for (const part of parts) {
        node = childNamed(node, part);
        node.value += file.seconds;
      }
    }
    roots.push(root);
  }
  return { roots, relativePaths };
}

export function Code(props: {
  rows: ActivityRow[];
  files: FileRow[];
  dependencies: DependencyRow[];
  filters: Filter[];
  onFilter: (dimension: Dimension, value: string | null) => void;
}) {
  const code = useMemo(() => {
    const tree = buildTree(props.files);
    const treemap = {
      tooltip: {
        formatter: (params: { treePathInfo: { name: string }[]; value: number }) =>
          `${params.treePathInfo
            .slice(1)
            .map((item) => item.name)
            .join("/")}<br/><b>${formatDuration(params.value)}</b>`,
      },
      series: [
        {
          type: "treemap",
          name: "All projects",
          data: tree.roots,
          left: 0,
          right: 0,
          top: 0,
          bottom: 28,
          roam: false,
          leafDepth: 3,
          visibleMin: 200,
          nodeClick: "zoomToNode",
          breadcrumb: {
            bottom: 0,
            left: 0,
            itemStyle: { color: "#18181b", borderColor: "#3f3f46", textStyle: { color: "#d4d4d8" } },
            emphasis: { itemStyle: { color: "#27272a" } },
          },
          label: { color: "#09090b", fontSize: 11 },
          upperLabel: { show: true, height: 20, color: "#e4e4e7", fontSize: 11 },
          levels: [
            { itemStyle: { borderColor: "#09090b", borderWidth: 0, gapWidth: 3 }, upperLabel: { show: false } },
            { itemStyle: { borderColor: "#18181b", borderWidth: 3, gapWidth: 1 }, colorSaturation: [0.35, 0.6] },
            { itemStyle: { borderColorSaturation: 0.3, borderWidth: 2, gapWidth: 1 }, colorSaturation: [0.3, 0.55] },
            { itemStyle: { borderColorSaturation: 0.3, borderWidth: 1, gapWidth: 1 }, colorSaturation: [0.3, 0.5] },
          ],
        },
      ],
    };

    const fileTypeFiles = props.files.filter((file) => file.type === "file");
    const editedSeconds = sum(fileTypeFiles.filter((file) => file.writes > 0), (file) => file.seconds);
    const readSeconds = sum(fileTypeFiles.filter((file) => file.writes === 0), (file) => file.seconds);
    const languages = sortedEntries(groupSum(fileTypeFiles, (file) => file.language, (file) => file.seconds)).slice(0, 10);
    const editedByLanguage = groupSum(
      fileTypeFiles.filter((file) => file.writes > 0),
      (file) => file.language,
      (file) => file.seconds,
    );
    const readingWriting = {
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number) => formatDuration(value) },
      xAxis: hoursAxis(Math.max(0, ...languages.map((entry) => entry[1]))),
      yAxis: { type: "category", inverse: true, data: languages.map((entry) => label(entry[0])) },
      series: [
        {
          type: "bar",
          stack: "time",
          name: "Files you edited",
          color: "#34d399",
          barMaxWidth: 16,
          data: languages.map((entry) => editedByLanguage.get(entry[0]) ?? 0),
        },
        {
          type: "bar",
          stack: "time",
          name: "Files you only read",
          color: "#60a5fa",
          barMaxWidth: 16,
          data: languages.map((entry) => entry[1] - (editedByLanguage.get(entry[0]) ?? 0)),
        },
      ],
    };

    const human = groupSum(props.rows, (row) => row.project, (row) => row.human_lines);
    const ai = groupSum(props.rows, (row) => row.project, (row) => row.ai_lines);
    const lineProjects = sortedEntries(groupSum(props.rows, (row) => row.project, (row) => Math.abs(row.human_lines) + Math.abs(row.ai_lines)))
      .filter((entry) => entry[1] > 0)
      .slice(0, 10)
      .map((entry) => entry[0]);
    const lines = {
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number) => `${formatNumber(value)} lines` },
      xAxis: { type: "value" },
      yAxis: { type: "category", inverse: true, data: lineProjects.map(label) },
      series: [
        { type: "bar", stack: "lines", name: "Human", color: "#60a5fa", barMaxWidth: 16, data: lineProjects.map((project) => human.get(project) ?? 0) },
        { type: "bar", stack: "lines", name: "AI", color: "#f472b6", barMaxWidth: 16, data: lineProjects.map((project) => ai.get(project) ?? 0) },
      ],
    };

    const mostEdited = [...props.files]
      .filter((file) => file.writes > 0 || file.human_lines !== 0 || file.ai_lines !== 0)
      .sort((a, b) => b.writes - a.writes || Math.abs(b.human_lines) + Math.abs(b.ai_lines) - (Math.abs(a.human_lines) + Math.abs(a.ai_lines)))
      .slice(0, 15);

    const dependencyProjects = sortedEntries(groupSum(props.dependencies, (dependency) => dependency.project, (dependency) => dependency.seconds))
      .slice(0, 6)
      .map((entry) => {
        const dependencies = props.dependencies.filter((dependency) => dependency.project === entry[0]).sort((a, b) => b.seconds - a.seconds);
        return { project: entry[0], count: dependencies.length, top: dependencies.slice(0, 8) };
      });

    return {
      tree,
      treemap,
      readingWriting,
      lines,
      lineProjects,
      sideHeight: Math.max(220, Math.max(languages.length, lineProjects.length) * 28 + 40),
      mostEdited,
      dependencyProjects,
      editedSeconds,
      readSeconds,
      writes: sum(props.rows, (row) => row.writes),
      codedSeconds: sum(props.rows, (row) => row.seconds),
      humanLines: sum(props.rows, (row) => row.human_lines),
      aiLines: sum(props.rows, (row) => row.ai_lines),
    };
  }, [props.rows, props.files, props.dependencies]);

  if (props.files.length === 0 && props.rows.length === 0) {
    return <Empty title="No activity in this range">Try a longer range or remove some filters.</Empty>;
  }

  return (
    <div className="space-y-4">
      <UnappliedFilters filters={props.filters} supported={["project", "language"]} source="Files" />
      <UnappliedFilters filters={props.filters} supported={["project"]} source="Dependencies" />

      <StatStrip>
        <Stat label="Files touched" value={formatNumber(props.files.filter((file) => file.type === "file").length)} detail={`${code.tree.roots.length} projects`} />
        <Stat
          label="Edited vs only read"
          value={`${formatPercent(code.editedSeconds, code.editedSeconds + code.readSeconds)} · ${formatPercent(code.readSeconds, code.editedSeconds + code.readSeconds)}`}
          detail={`${formatDuration(code.editedSeconds)} in edited files · ${formatDuration(code.readSeconds)} read-only`}
        />
        <Stat
          label="Saves"
          value={formatNumber(code.writes)}
          detail={`${code.codedSeconds === 0 ? 0 : (code.writes / (code.codedSeconds / 3600)).toFixed(1)} per coding hour`}
        />
        <Stat
          label="Line changes"
          value={formatNumber(code.humanLines + code.aiLines)}
          detail={`${formatNumber(code.humanLines)} human · ${formatNumber(code.aiLines)} AI`}
        />
      </StatStrip>

      <Panel title="Time per folder and file" subtitle="Click a block to zoom in; use the breadcrumb to go back">
        {code.tree.roots.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500">No files in this range</p>
        ) : (
          <Chart option={code.treemap} height={480} />
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Writing vs reading" subtitle="Time in files you saved at least once vs files you only read, by language">
          <Chart option={code.readingWriting} height={code.sideHeight} />
        </Panel>
        <Panel title="Line changes by project" subtitle="Human vs AI line changes · click to filter">
          {code.lineProjects.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">No line changes recorded</p>
          ) : (
            <Chart
              option={code.lines}
              height={code.sideHeight}
              onClick={(event) => {
                const project = code.lineProjects[event.dataIndex];
                if (project !== undefined) {
                  props.onFilter("project", project);
                }
              }}
            />
          )}
        </Panel>
      </div>

      <Panel title="Most edited files" subtitle="By number of saves">
        {code.mostEdited.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500">No saved files in this range</p>
        ) : (
          <table className="w-full table-fixed text-left text-xs">
            <thead className="text-zinc-500">
              <tr className="border-b border-zinc-800">
                <th className="py-2 pr-4 font-normal">File</th>
                <th className="w-40 py-2 pr-4 font-normal">Project</th>
                <th className="w-28 py-2 pr-4 font-normal">Language</th>
                <th className="w-20 py-2 pr-4 text-right font-normal">Time</th>
                <th className="w-16 py-2 pr-4 text-right font-normal">Saves</th>
                <th className="w-20 py-2 pr-4 text-right font-normal">Human</th>
                <th className="w-16 py-2 text-right font-normal">AI</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {code.mostEdited.map((file) => (
                <tr key={`${file.project}:${file.entity}:${file.type}:${file.language}`} className="border-b border-zinc-800/50 text-zinc-300">
                  <td className="truncate py-1.5 pr-4 text-zinc-100" title={file.entity}>
                    {code.tree.relativePaths.get(file) ?? file.entity}
                  </td>
                  <td className="truncate py-1.5 pr-4">
                    <button type="button" onClick={() => props.onFilter("project", file.project)} className="hover:text-sky-300">
                      {label(file.project)}
                    </button>
                  </td>
                  <td className="truncate py-1.5 pr-4">
                    <button type="button" onClick={() => props.onFilter("language", file.language)} className="hover:text-sky-300">
                      {label(file.language)}
                    </button>
                  </td>
                  <td className="py-1.5 pr-4 text-right">{formatDuration(file.seconds)}</td>
                  <td className="py-1.5 pr-4 text-right text-zinc-100">{formatNumber(file.writes)}</td>
                  <td className="py-1.5 pr-4 text-right">{formatNumber(file.human_lines)}</td>
                  <td className="py-1.5 text-right">{formatNumber(file.ai_lines)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Dependencies by project" subtitle="Time in files that import each dependency">
        {code.dependencyProjects.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500">No dependencies detected in this range</p>
        ) : (
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
            {code.dependencyProjects.map((group) => {
              const max = group.top[0]?.seconds ?? 0;
              return (
                <div key={group.project ?? "\u0000"}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <button type="button" onClick={() => props.onFilter("project", group.project)} className="truncate text-xs font-medium text-zinc-100 hover:text-sky-300">
                      {label(group.project)}
                    </button>
                    <span className="text-[11px] text-zinc-500">{group.count} dependencies</span>
                  </div>
                  <ul className="space-y-1">
                    {group.top.map((dependency) => (
                      <li key={dependency.dependency} className="relative flex items-center justify-between gap-2 px-1.5 py-0.5 text-xs">
                        <span
                          className="absolute inset-y-0 left-0 rounded-sm opacity-20"
                          style={{ width: `${max === 0 ? 0 : (dependency.seconds / max) * 100}%`, background: colorFor(group.project) }}
                        />
                        <span className="relative truncate text-zinc-300">{dependency.dependency}</span>
                        <span className="relative text-zinc-400 tabular-nums">{formatDuration(dependency.seconds)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
