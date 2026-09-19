export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: string): boolean {
  const num = Number(value)
  return Number.isInteger(num) && num > 0
}

export class ObjectPathError extends Error {
  constructor(path: string, expectedType: string, actualType: string) {
    const message = `Expected ${expectedType} at path '${path}', but found: ${actualType}`
    super(message)
    this.name = 'ObjectPathError'
  }
}

export function getValue(obj: unknown, key: string): any {
  const paths = key.split('.')
  let current: unknown = obj
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!
    if (isPositiveInteger(path)) {
      if (!Array.isArray(current)) {
        throw new ObjectPathError(
          paths.slice(0, i + 1).join('.'),
          'array',
          typeof current,
        )
      }
      const ind = Number(path)
      current = current[ind]
    } else {
      if (!isRecord(current)) {
        throw new ObjectPathError(
          paths.slice(0, i + 1).join('.'),
          'object',
          typeof current,
        )
      }
      current = current[path]
    }
  }
  return current
}