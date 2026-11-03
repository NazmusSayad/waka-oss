export function sum<T>(items: T[], value: (item: T) => number) {
  let total = 0
  for (const item of items) {
    total += value(item)
  }
  return total
}

export function groupSum<T, K>(
  items: T[],
  key: (item: T) => K,
  value: (item: T) => number
) {
  const groups = new Map<K, number>()
  for (const item of items) {
    const groupKey = key(item)
    groups.set(groupKey, (groups.get(groupKey) ?? 0) + value(item))
  }
  return groups
}

export function sortedEntries<K>(groups: Map<K, number>) {
  return [...groups.entries()].sort((a, b) => b[1] - a[1])
}
