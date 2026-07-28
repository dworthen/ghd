export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isStringRecord(
  value: unknown,
): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  )
}