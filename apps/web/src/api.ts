export type Status = {
  timezone: string;
  today: string;
  server_time: number;
  first_date: string | null;
  last_heartbeat: {
    time: number;
    entity: string;
    project: string | null;
    language: string | null;
    branch: string | null;
    category: string | null;
    editor: string | null;
    machine: string | null;
  } | null;
};

export type ActivityRow = {
  date: string;
  hour: number;
  project: string | null;
  language: string | null;
  branch: string | null;
  category: string | null;
  editor: string | null;
  os: string | null;
  machine: string | null;
  seconds: number;
  heartbeats: number;
  writes: number;
  human_lines: number;
  ai_lines: number;
  ai_input_tokens: number;
  ai_output_tokens: number;
};

export type Session = {
  date: string;
  start: number;
  end: number;
  seconds: number;
  heartbeats: number;
  main_project: string | null;
  projects: (string | null)[];
  languages: (string | null)[];
  file_switches: number;
};

export type FileRow = {
  project: string | null;
  entity: string;
  type: string | null;
  language: string | null;
  seconds: number;
  heartbeats: number;
  writes: number;
  human_lines: number;
  ai_lines: number;
};

export type DependencyRow = {
  project: string | null;
  dependency: string;
  seconds: number;
};

export type DayHeartbeat = {
  time: number;
  duration: number;
  entity: string;
  type: string | null;
  category: string | null;
  project: string | null;
  branch: string | null;
  language: string | null;
  editor: string | null;
  machine: string | null;
  is_write: boolean;
  lineno: number | null;
  human_line_changes: number | null;
  ai_line_changes: number | null;
};

export async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
