import type { ActivityRow } from '@/api/types'
import type { Dimension } from '@/constants/dimensions'
import { groupSum, sortedEntries } from '@/utils/aggregate'
import { label } from '@/utils/format'

export function nodeLabel(name: string) {
  return name.slice(name.indexOf(':') + 1)
}

export function sankey(rows: ActivityRow[]) {
  const projects = sortedEntries(
    groupSum(
      rows,
      (row) => row.project,
      (row) => row.seconds
    )
  )
    .slice(0, 10)
    .map((entry) => entry[0])
  const languages = sortedEntries(
    groupSum(
      rows,
      (row) => row.language,
      (row) => row.seconds
    )
  )
    .slice(0, 10)
    .map((entry) => entry[0])
  const nodes: {
    name: string
    dimension: Dimension | null
    key: string | null
  }[] = []
  const links = new Map<
    string,
    { source: string; target: string; value: number }
  >()
  function nodeName(
    dimension: Dimension,
    value: string | null,
    isTop: boolean
  ) {
    const name = isTop ? `${dimension}:${label(value)}` : `${dimension}:Other`
    if (!nodes.some((node) => node.name === name)) {
      nodes.push({ name, dimension: isTop ? dimension : null, key: value })
    }
    return name
  }
  function addLink(source: string, target: string, value: number) {
    const id = `${source}→${target}`
    const existing = links.get(id)
    if (existing === undefined) {
      links.set(id, { source, target, value })
      return
    }
    existing.value += value
  }
  for (const row of rows) {
    if (row.seconds <= 0) {
      continue
    }
    const project = nodeName(
      'project',
      row.project,
      projects.includes(row.project)
    )
    const language = nodeName(
      'language',
      row.language,
      languages.includes(row.language)
    )
    const category = nodeName('category', row.category, true)
    addLink(project, language, row.seconds)
    addLink(language, category, row.seconds)
  }
  return { nodes, links: [...links.values()] }
}
