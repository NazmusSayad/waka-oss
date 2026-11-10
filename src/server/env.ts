export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`environment variable ${name} must be set`)
  }
  return value
}
