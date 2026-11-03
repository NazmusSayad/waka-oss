export const dimensions = [
  'project',
  'language',
  'branch',
  'category',
  'editor',
  'os',
  'machine',
] as const

export type Dimension = (typeof dimensions)[number]

export const dimensionLabels: Record<Dimension, string> = {
  project: 'Project',
  language: 'Language',
  branch: 'Branch',
  category: 'Category',
  editor: 'Editor',
  os: 'OS',
  machine: 'Machine',
}
