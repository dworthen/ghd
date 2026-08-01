export function hashStringToHex(value: string): string {
  return Bun.hash.xxHash64(value).toString(16)
}