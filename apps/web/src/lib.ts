import type { ActivityRow } from "./api";

export const dimensions = ["project", "language", "branch", "category", "editor", "os", "machine"] as const;
export type Dimension = (typeof dimensions)[number];

export const dimensionLabels: Record<Dimension, string> = {
  project: "Project",
  language: "Language",
  branch: "Branch",
  category: "Category",
  editor: "Editor",
  os: "OS",
  machine: "Machine",
};

export type Filter = { dimension: Dimension; value: string | null };

export type Range = { from: string; to: string };

export function label(value: string | null) {
  return value === null ? "Unknown" : value;
}

export function formatDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes === 0) {
    return seconds > 0 ? "<1m" : "0m";
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

export function formatHoursAxis(seconds: number) {
  const hours = seconds / 3600;
  if (hours === 0) {
    return "0";
  }
  if (hours < 1) {
    return `${Math.round(seconds / 60)}m`;
  }
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

const hourSteps = [300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200, 86400, 172800, 432000, 864000, 1728000, 3600000];

export function hoursAxis(maxSeconds: number) {
  return {
    type: "value",
    interval: hourSteps.find((step) => maxSeconds / step <= 5),
    axisLabel: { formatter: formatHoursAxis },
  };
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value >= 100000 ? "compact" : "standard" }).format(Math.round(value));
}

export function formatPercent(part: number, total: number) {
  if (total === 0) {
    return "0%";
  }
  const percent = (part / total) * 100;
  return `${percent < 10 && percent > 0 ? percent.toFixed(1) : Math.round(percent)}%`;
}

function dayNumber(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / 86400000;
}

export function addDays(date: string, days: number) {
  return new Date((dayNumber(date) + days) * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round(dayNumber(to) - dayNumber(from));
}

export function datesInRange(range: Range) {
  const dates: string[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function weekdayIndex(date: string) {
  return (new Date(dayNumber(date) * 86400000).getUTCDay() + 6) % 7;
}

export const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(dayNumber(date) * 86400000);
}

export function formatRange(range: Range) {
  if (range.from === range.to) {
    return formatDate(range.from, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  const from = formatDate(range.from, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${from} – ${formatDate(range.to, { month: "short", day: "numeric", year: "numeric" })}`;
}

export function previousRange(range: Range): Range {
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

function clockFormat(timeZone: string) {
  const existing = clockFormats.get(timeZone);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  clockFormats.set(timeZone, created);
  return created;
}

export function secondsIntoDay(time: number, timeZone: string) {
  const parts = clockFormat(timeZone).formatToParts(time * 1000);
  let total = 0;
  for (const part of parts) {
    if (part.type === "hour") {
      total += Number(part.value) * 3600;
    }
    if (part.type === "minute") {
      total += Number(part.value) * 60;
    }
    if (part.type === "second") {
      total += Number(part.value);
    }
  }
  return total;
}

export function formatClock(time: number, timeZone: string) {
  return clockFormat(timeZone).format(time * 1000).slice(0, 5);
}

export function formatHourOfDay(secondsOfDay: number) {
  const totalMinutes = Math.round(secondsOfDay / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  if (hours >= 24) {
    return `${String(hours - 24).padStart(2, "0")}:${minutes} +1d`;
  }
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

export function passes(filters: Filter[], dimension: Dimension, values: (string | null)[]) {
  const selected = filters.filter((filter) => filter.dimension === dimension);
  return selected.length === 0 || selected.some((filter) => values.includes(filter.value));
}

export function matchesFilters(filters: Filter[], record: Partial<Record<Dimension, (string | null)[]>>) {
  for (const filter of filters) {
    const values = record[filter.dimension];
    if (values !== undefined && !passes(filters, filter.dimension, values)) {
      return false;
    }
  }
  return true;
}

export function applyFilters(rows: ActivityRow[], filters: Filter[]) {
  if (filters.length === 0) {
    return rows;
  }
  return rows.filter((row) => dimensions.every((dimension) => passes(filters, dimension, [row[dimension]])));
}

export function sum<T>(items: T[], value: (item: T) => number) {
  let total = 0;
  for (const item of items) {
    total += value(item);
  }
  return total;
}

export function groupSum<T, K>(items: T[], key: (item: T) => K, value: (item: T) => number) {
  const groups = new Map<K, number>();
  for (const item of items) {
    const groupKey = key(item);
    groups.set(groupKey, (groups.get(groupKey) ?? 0) + value(item));
  }
  return groups;
}

export function sortedEntries<K>(groups: Map<K, number>) {
  return [...groups.entries()].sort((a, b) => b[1] - a[1]);
}

const palette = ["#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#22d3ee", "#fb923c", "#f87171", "#a3e635", "#e879f9", "#2dd4bf", "#818cf8"];

const assignedColors = new Map<string, string>();

export function colorFor(value: string | null) {
  if (value === null) {
    return "#71717a";
  }
  const existing = assignedColors.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const color = palette[assignedColors.size % palette.length] ?? "#71717a";
  assignedColors.set(value, color);
  return color;
}

export const otherColor = "#3f3f46";

export type Granularity = "hour" | "day" | "week" | "month";

export function granularityFor(range: Range): Granularity {
  const days = daysBetween(range.from, range.to) + 1;
  if (days === 1) {
    return "hour";
  }
  if (days <= 92) {
    return "day";
  }
  if (days <= 730) {
    return "week";
  }
  return "month";
}

export function bucketOf(row: { date: string; hour: number }, granularity: Granularity) {
  if (granularity === "hour") {
    return `${String(row.hour).padStart(2, "0")}:00`;
  }
  if (granularity === "day") {
    return row.date;
  }
  if (granularity === "week") {
    return addDays(row.date, -weekdayIndex(row.date));
  }
  return row.date.slice(0, 7);
}

export function bucketsFor(range: Range, granularity: Granularity) {
  if (granularity === "hour") {
    return Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
  }
  const buckets = new Set<string>();
  for (const date of datesInRange(range)) {
    buckets.add(bucketOf({ date, hour: 0 }, granularity));
  }
  return [...buckets];
}

export function formatBucket(bucket: string, granularity: Granularity) {
  if (granularity === "hour") {
    return bucket;
  }
  if (granularity === "month") {
    return formatDate(`${bucket}-01`, { month: "short", year: "numeric" });
  }
  return formatDate(bucket, { month: "short", day: "numeric" });
}
