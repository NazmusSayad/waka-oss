import { z } from 'zod'
import type { Statement } from './db.ts'
import { localTime } from './time.ts'

export const heartbeatsSchema = z.array(
  z.object({
    time: z.number(),
    entity: z.string(),
    type: z.string().nullish(),
    category: z.string().nullish(),
    project: z.string().nullish(),
    branch: z.string().nullish(),
    language: z.string().nullish(),
    dependencies: z.array(z.string()).nullish(),
    lines: z.int().nullish(),
    lineno: z.int().nullish(),
    cursorpos: z.int().nullish(),
    is_write: z.boolean().nullish(),
    project_root_count: z.int().nullish(),
    human_line_changes: z.int().nullish(),
    ai_line_changes: z.int().nullish(),
    ai_session: z.string().nullish(),
    ai_input_tokens: z.int().nullish(),
    ai_output_tokens: z.int().nullish(),
    ai_cached_input_tokens: z.int().nullish(),
    ai_prompt_length: z.int().nullish(),
    ai_subscription_plan: z.string().nullish(),
    user_agent: z.string().nullish(),
  })
)

export type Heartbeat = z.infer<typeof heartbeatsSchema>[number]

export function insertStatements(heartbeat: Heartbeat, machine: string | null): Statement[] {
  const { os, editor } =
    heartbeat.user_agent === null || heartbeat.user_agent === undefined
      ? { os: null, editor: null }
      : parseUserAgent(heartbeat.user_agent)
  const local = localTime(heartbeat.time)
  const isWrite = heartbeat.is_write === true ? 1 : heartbeat.is_write === false ? 0 : null
  return [
    {
      sql: `INSERT OR IGNORE INTO heartbeats (time, entity, type, category, project, branch, language,
        dependencies, lines, lineno, cursorpos, is_write, project_root_count, human_line_changes,
        ai_line_changes, ai_session, ai_input_tokens, ai_output_tokens, ai_cached_input_tokens,
        ai_prompt_length, ai_subscription_plan, user_agent, editor, os, machine, local_date, local_hour)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        heartbeat.time,
        heartbeat.entity,
        heartbeat.type ?? null,
        heartbeat.category === null || heartbeat.category === undefined
          ? 'coding'
          : heartbeat.category.toLowerCase(),
        heartbeat.project ?? null,
        heartbeat.branch === '' ? null : (heartbeat.branch ?? null),
        heartbeat.language ?? null,
        heartbeat.dependencies === null || heartbeat.dependencies === undefined
          ? null
          : JSON.stringify(heartbeat.dependencies),
        heartbeat.lines ?? null,
        heartbeat.lineno ?? null,
        heartbeat.cursorpos ?? null,
        isWrite,
        heartbeat.project_root_count ?? null,
        heartbeat.human_line_changes ?? null,
        heartbeat.ai_line_changes ?? null,
        heartbeat.ai_session ?? null,
        heartbeat.ai_input_tokens ?? null,
        heartbeat.ai_output_tokens ?? null,
        heartbeat.ai_cached_input_tokens ?? null,
        heartbeat.ai_prompt_length ?? null,
        heartbeat.ai_subscription_plan ?? null,
        heartbeat.user_agent ?? null,
        editor,
        os,
        machine,
        local.date,
        local.hour,
      ],
    },
    {
      sql: 'SELECT id FROM heartbeats WHERE time = ? AND entity = ?',
      args: [heartbeat.time, heartbeat.entity],
    },
  ]
}

export function parseUserAgent(userAgent: string) {
  if (!userAgent.startsWith('wakatime/')) {
    const tokens = userAgent.split(/\s+/).filter((token) => token !== '')
    const first = tokens[0]
    const platform = tokens[1]
    const editor =
      first !== undefined && first.includes('/') ? first.slice(0, first.indexOf('/')).toLowerCase() : null
    const osName =
      platform !== undefined && platform.includes('_') ? platform.slice(0, platform.indexOf('_')) : null
    const os = osName === 'win' ? 'windows' : osName === 'mac' ? 'darwin' : osName
    return { os, editor }
  }
  const open = userAgent.indexOf('(')
  const close = open === -1 ? -1 : userAgent.indexOf(')', open)
  const platform = close === -1 ? null : userAgent.slice(open + 1, close)
  const os =
    platform === null
      ? null
      : platform.includes('microsoft-standard-WSL')
        ? 'wsl'
        : platform.includes('-')
          ? platform.slice(0, platform.indexOf('-'))
          : null
  const rest = userAgent.indexOf(') ')
  const tools =
    rest === -1
      ? []
      : userAgent
          .slice(rest + 2)
          .split(/\s+/)
          .filter((token) => token.includes('/'))
          .map((token) => token.slice(0, token.indexOf('/')))
          .filter((name) => !name.endsWith('-wakatime'))
  const editor = tools.length === 1 ? tools[0] : tools.length > 1 ? tools[1] : undefined
  return { os, editor: editor === undefined ? null : editor.toLowerCase() }
}

const forwardedHeaders = ['authorization', 'user-agent', 'content-type', 'x-machine-name', 'timezone']

export function forwardApiUrl() {
  const url = process.env.FORWARD_API_URL
  if (url === undefined) {
    return null
  }
  return url.replace(/\/+$/, '')
}

export function forward(method: string, url: string, headers: Headers, body: ArrayBuffer | null) {
  const forwarded = new Headers()
  for (const name of forwardedHeaders) {
    const value = headers.get(name)
    if (value !== null) {
      forwarded.set(name, value)
    }
  }
  return fetch(url, { method, headers: forwarded, body })
}

export function summaryTime(totalSeconds: number) {
  const whole = Math.trunc(totalSeconds)
  const hours = Math.trunc(whole / 3600)
  const minutes = Math.trunc((whole % 3600) / 60)
  const seconds = whole % 60
  const parts: string[] = []
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`)
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'min' : 'mins'}`)
  }
  if (parts.length === 0) {
    parts.push(`${seconds} ${seconds === 1 ? 'sec' : 'secs'}`)
  }
  return {
    decimal: (totalSeconds / 3600).toFixed(2),
    digital: `${hours}:${String(minutes).padStart(2, '0')}`,
    hours,
    minutes,
    text: parts.join(' '),
    total_seconds: totalSeconds,
  }
}
