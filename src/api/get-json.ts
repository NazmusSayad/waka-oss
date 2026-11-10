export async function getJson<T>(
  path: string,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(path, { signal })
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${response.statusText}`)
  }
  return response.json()
}
