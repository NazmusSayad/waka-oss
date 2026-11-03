import type { FileRow } from '@/api/types'
import { groupSum, sortedEntries } from '@/utils/aggregate'
import { colorFor } from '@/utils/colors'
import { label } from '@/utils/format'

type TreeNode = {
  name: string
  value: number
  children: TreeNode[]
  itemStyle?: { color: string }
}

function childNamed(node: TreeNode, name: string) {
  const existing = node.children.find((child) => child.name === name)
  if (existing !== undefined) {
    return existing
  }
  const created: TreeNode = { name, value: 0, children: [] }
  node.children.push(created)
  return created
}

function splitPath(path: string) {
  return path.split(/[\\/]/).filter((part) => part !== '')
}

export function buildTree(files: FileRow[]) {
  const relativePaths = new Map<FileRow, string>()
  const roots: TreeNode[] = []
  for (const projectEntry of sortedEntries(
    groupSum(
      files,
      (file) => file.project,
      (file) => file.seconds
    )
  )) {
    const projectFiles = files.filter(
      (file) => file.project === projectEntry[0] && file.seconds > 0
    )
    const root: TreeNode = {
      name: label(projectEntry[0]),
      value: 0,
      children: [],
      itemStyle: { color: colorFor(projectEntry[0]) },
    }
    const directories = projectFiles
      .filter((file) => file.type === 'file')
      .map((file) => splitPath(file.entity).slice(0, -1))
    const firstDirectory = directories[0] ?? []
    let prefixLength = firstDirectory.length
    for (const directory of directories) {
      let index = 0
      while (
        index < prefixLength &&
        directory[index] === firstDirectory[index]
      ) {
        index++
      }
      prefixLength = index
    }
    for (const file of projectFiles) {
      const parts =
        file.type === 'file'
          ? splitPath(file.entity).slice(prefixLength)
          : [`(${label(file.type)})`, file.entity]
      relativePaths.set(
        file,
        file.type === 'file' ? parts.join('/') : file.entity
      )
      root.value += file.seconds
      let node = root
      for (const part of parts) {
        node = childNamed(node, part)
        node.value += file.seconds
      }
    }
    roots.push(root)
  }
  return { roots, relativePaths }
}
