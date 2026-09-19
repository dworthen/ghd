export function generateRandomString(
  bytes: number,
  format: 'hex' | 'base64' | 'base64url' = 'hex',
): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  switch (format) {
    case 'hex':
      return array.toHex()
    case 'base64':
    case 'base64url':
      return array.toBase64({ alphabet: format })
    default:
      throw new Error(`Unsupported format: ${format}`)
  }
}