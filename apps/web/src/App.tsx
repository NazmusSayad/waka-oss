import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { RefreshCw, X } from "lucide-react";
import { getJson, type ActivityRow, type DependencyRow, type FileRow, type Session, type Status } from "./api";
import {
  addDays,
  applyFilters,
  dimensionLabels,
  dimensions,
  formatRange,
  label,
  matchesFilters,
  previousRange,
  type Dimension,
  type Filter,
  type Range,
} from "./lib";
import { Empty } from "./ui";
import { Overview } from "./views/Overview";
import { Explore } from "./views/Explore";
import { Patterns } from "./views/Patterns";
import { Timeline } from "./views/Timeline";
import { Code } from "./views/Code";
import { Ai } from "./views/Ai";
import { Branches } from "./views/Branches";

const views = [
  { id: "overview", label: "Overview" },
  { id: "explore", label: "Explore" },
  { id: "patterns", label: "Patterns" },
  { id: "timeline", label: "Day timeline" },
  { id: "code", label: "Code" },
  { id: "ai", label: "AI vs human" },
  { id: "branches", label: "Branches" },
] as const;

const presets = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
] as const;
type Preset = (typeof presets)[number]["id"];

type Loaded = {
  key: string;
  status: Status;
  range: Range;
  previous: Range;
  rows: ActivityRow[];
  previousRows: ActivityRow[];
  recentRows: ActivityRow[];
  sessions: Session[];
  files: FileRow[];
  dependencies: DependencyRow[];
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  const view = views.find((item) => item.id === params.get("view"));
  const preset = presets.find((item) => item.id === params.get("range"));
  const from = params.get("from");
  const to = params.get("to");
  const customValid = from !== null && to !== null && datePattern.test(from) && datePattern.test(to) && from <= to;
  const filters: Filter[] = [];
  for (const raw of params.getAll("f")) {
    const separator = raw.indexOf("=");
    const name = separator === -1 ? raw : raw.slice(0, separator);
    const dimension = dimensions.find((item) => item === name);
    if (dimension !== undefined) {
      filters.push({ dimension, value: separator === -1 ? null : raw.slice(separator + 1) });
    }
  }
  const day = params.get("day");
  return {
    view: view === undefined ? "overview" : view.id,
    preset: preset === undefined || (preset.id === "custom" && !customValid) ? "30d" : preset.id,
    customFrom: customValid ? from : "",
    customTo: customValid ? to : "",
    compare: params.get("compare") === "1",
    filters,
    day: day !== null && datePattern.test(day) ? day : null,
  };
}

function resolveRange(preset: Preset, customFrom: string, customTo: string, status: Status): Range {
  const today = status.today;
  if (preset === "today") {
    return { from: today, to: today };
  }
  if (preset === "7d") {
    return { from: addDays(today, -6), to: today };
  }
  if (preset === "30d") {
    return { from: addDays(today, -29), to: today };
  }
  if (preset === "year") {
    return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
  if (preset === "all") {
    return { from: status.first_date === null ? today : status.first_date, to: today };
  }
  return { from: customFrom, to: customTo };
}

const initial = readUrl();

export function App() {
  const [view, setView] = useState(initial.view);
  const [preset, setPreset] = useState(initial.preset);
  const [customFrom, setCustomFrom] = useState(initial.customFrom);
  const [customTo, setCustomTo] = useState(initial.customTo);
  const [compare, setCompare] = useState(initial.compare);
  const [filters, setFilters] = useState(initial.filters);
  const [day, setDay] = useState(initial.day);
  const [reloadCount, setReloadCount] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const requestKey = `${preset}|${customFrom}|${customTo}|${reloadCount}`;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${preset}|${customFrom}|${customTo}|${reloadCount}`;
    async function load() {
      try {
        const status = await getJson<Status>("/api/status", controller.signal);
        const range = resolveRange(preset, customFrom, customTo, status);
        const previous = previousRange(range);
        const query = `from=${range.from}&to=${range.to}`;
        const responses = await Promise.all([
          getJson<{ rows: ActivityRow[] }>(`/api/activity?${query}`, controller.signal),
          getJson<{ rows: ActivityRow[] }>(`/api/activity?from=${previous.from}&to=${previous.to}`, controller.signal),
          getJson<{ rows: ActivityRow[] }>(`/api/activity?from=${addDays(status.today, -59)}&to=${status.today}`, controller.signal),
          getJson<{ sessions: Session[] }>(`/api/sessions?${query}`, controller.signal),
          getJson<{ rows: FileRow[] }>(`/api/files?${query}`, controller.signal),
          getJson<{ rows: DependencyRow[] }>(`/api/dependencies?${query}`, controller.signal),
        ]);
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
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setFailure({ key, message: error instanceof Error ? error.message : String(error) });
      }
    }
    load();
    return () => controller.abort();
  }, [preset, customFrom, customTo, reloadCount]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("view", view);
    params.set("range", preset);
    if (preset === "custom") {
      params.set("from", customFrom);
      params.set("to", customTo);
    }
    if (compare) {
      params.set("compare", "1");
    }
    for (const filter of filters) {
      params.append("f", filter.value === null ? filter.dimension : `${filter.dimension}=${filter.value}`);
    }
    if (view === "timeline" && day !== null) {
      params.set("day", day);
    }
    window.history.replaceState(null, "", `?${params}`);
  }, [view, preset, customFrom, customTo, compare, filters, day]);

  const filtered = useMemo(() => {
    if (loaded === null) {
      return null;
    }
    return {
      rows: applyFilters(loaded.rows, filters),
      previousRows: applyFilters(loaded.previousRows, filters),
      recentRows: applyFilters(loaded.recentRows, filters),
      sessions: loaded.sessions.filter((session) => matchesFilters(filters, { project: session.projects, language: session.languages })),
      files: loaded.files.filter((file) => matchesFilters(filters, { project: [file.project], language: [file.language] })),
      dependencies: loaded.dependencies.filter((dependency) => matchesFilters(filters, { project: [dependency.project] })),
    };
  }, [loaded, filters]);

  const loading = loaded?.key !== requestKey && failure?.key !== requestKey;
  const currentFailure = failure?.key === requestKey ? failure : null;

  function addFilter(dimension: Dimension, value: string | null) {
    if (filters.some((filter) => filter.dimension === dimension && filter.value === value)) {
      return;
    }
    setFilters([...filters, { dimension, value }]);
  }

  function openDay(date: string) {
    setDay(date);
    setView("timeline");
  }

  function selectPreset(next: Preset) {
    if (next === "custom" && loaded !== null) {
      setCustomFrom(loaded.range.from);
      setCustomTo(loaded.range.to);
    }
    setPreset(next);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-6 pt-3">
          <span className="text-sm font-semibold tracking-tight text-zinc-100">waka</span>
          <nav className="-mb-px flex flex-1 gap-1 overflow-x-auto">
            {views.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={clsx(
                  "border-b-2 px-3 pt-1 pb-2.5 text-sm whitespace-nowrap",
                  view === item.id ? "border-sky-400 text-zinc-50" : "border-transparent text-zinc-400 hover:text-zinc-200",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setReloadCount(reloadCount + 1)}
            disabled={loading}
            className="mb-2 flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 disabled:opacity-60"
          >
            <RefreshCw size={13} className={clsx(loading && "animate-spin")} />
            Refresh
          </button>
        </div>
        <div className="border-t border-zinc-800/60">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2">
            <div className="flex rounded-md border border-zinc-800 p-0.5">
              {presets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectPreset(item.id)}
                  className={clsx(
                    "rounded px-2.5 py-1 text-xs",
                    preset === item.id ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(event) => event.target.value !== "" && setCustomFrom(event.target.value)}
                  className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-200"
                />
                to
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  onChange={(event) => event.target.value !== "" && setCustomTo(event.target.value)}
                  className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-200"
                />
              </div>
            )}
            {loaded !== null && <span className="text-xs text-zinc-400 tabular-nums">{formatRange(loaded.range)}</span>}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400 select-none">
              <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} className="accent-sky-400" />
              Compare with previous period
              {compare && loaded !== null && <span className="text-zinc-500">({formatRange(loaded.previous)})</span>}
            </label>
            {filters.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 lg:ml-auto">
                {filters.map((filter) => (
                  <span
                    key={`${filter.dimension}:${filter.value}`}
                    className="flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 py-0.5 pr-1 pl-2.5 text-xs text-sky-100"
                  >
                    <span className="text-sky-300/70">{dimensionLabels[filter.dimension]}</span>
                    {label(filter.value)}
                    <button
                      type="button"
                      aria-label="Remove filter"
                      onClick={() => setFilters(filters.filter((item) => item !== filter))}
                      className="rounded-full p-0.5 hover:bg-sky-400/20"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setFilters([])} className="px-1 text-xs text-zinc-500 hover:text-zinc-300">
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={clsx("mx-auto max-w-[1440px] px-6 py-5 transition-opacity", loading && loaded !== null && "opacity-60")}>
        {currentFailure !== null && (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <span>Couldn't load data: {currentFailure.message}</span>
            <button type="button" onClick={() => setReloadCount(reloadCount + 1)} className="text-xs underline">
              Try again
            </button>
          </div>
        )}
        {loaded === null && currentFailure === null && <p className="py-24 text-center text-sm text-zinc-500">Loading…</p>}
        {loaded !== null && filtered !== null && loaded.status.first_date === null && (
          <Empty title="No heartbeats yet">
            Point wakatime-cli at this server by setting <code className="text-zinc-300">api_url = {window.location.origin}/api/v1</code> in{" "}
            <code className="text-zinc-300">~/.wakatime.cfg</code>, then write some code.
          </Empty>
        )}
        {loaded !== null && filtered !== null && loaded.status.first_date !== null && (
          <>
            {view === "overview" && (
              <Overview
                status={loaded.status}
                rows={filtered.rows}
                previousRows={filtered.previousRows}
                recentRows={filtered.recentRows}
                range={loaded.range}
                compare={compare}
                onFilter={addFilter}
                onOpenDay={openDay}
              />
            )}
            {view === "explore" && (
              <Explore rows={filtered.rows} previousRows={filtered.previousRows} range={loaded.range} compare={compare} onFilter={addFilter} />
            )}
            {view === "patterns" && (
              <Patterns
                status={loaded.status}
                rows={filtered.rows}
                sessions={filtered.sessions}
                range={loaded.range}
                filters={filters}
                onOpenDay={openDay}
              />
            )}
            {view === "timeline" && (
              <Timeline
                status={loaded.status}
                date={day === null ? loaded.range.to : day}
                onDateChange={setDay}
                filters={filters}
                onFilter={addFilter}
              />
            )}
            {view === "code" && (
              <Code rows={filtered.rows} files={filtered.files} dependencies={filtered.dependencies} filters={filters} onFilter={addFilter} />
            )}
            {view === "ai" && (
              <Ai status={loaded.status} rows={filtered.rows} sessions={filtered.sessions} range={loaded.range} filters={filters} onFilter={addFilter} />
            )}
            {view === "branches" && <Branches rows={filtered.rows} range={loaded.range} onFilter={addFilter} />}
          </>
        )}
      </main>
    </div>
  );
}
