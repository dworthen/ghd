const PLACEHOLDER = /(\\?)\$\{([^}]+)\}/g

export function containsVars(value: string): boolean {
  return PLACEHOLDER.test(value)
}

export function replaceVars(
  value: string,
  vars: Record<string, string | undefined>,
): string {
  return value.replace(PLACEHOLDER, (_match, escaped: string, name: string) => {
    if (escaped) {
      return `\${${name}}`
    }
    const resolved = vars[name]
    if (resolved === undefined) {
      throw new Error(`Missing variable reference for substitution: ${name}`)
    }
    return resolved
  })
}