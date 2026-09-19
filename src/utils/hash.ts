function hashValue(value: string): bigint {
  return Bun.hash.xxHash64(value)
}

function bigintToUint8Array(value: bigint): Uint8Array {
  if (typeof value !== 'bigint') {
    throw new TypeError('Input must be a BigInt')
  }
  if (value < 0n) {
    throw new RangeError(
      'Negative BigInt values are not supported for unsigned conversion',
    )
  }

  // Special case for zero
  if (value === 0n) {
    return new Uint8Array([0])
  }

  const bytes: number[] = []
  let temp = value
  while (temp > 0n) {
    bytes.push(Number(temp & 0xffn)) // Take lowest 8 bits
    temp >>= 8n // Shift right by 8 bits
  }

  return Uint8Array.from(bytes)
}

function hashValueToHex(value: string): string {
  return bigintToUint8Array(hashValue(value)).toHex()
}

function hashValueToBase64(
  value: string,
  alphabet: 'base64' | 'base64url',
): string {
  return bigintToUint8Array(hashValue(value)).toBase64({
    alphabet,
  })
}

export function hash(
  value: string,
  format: 'hex' | 'base64' | 'base64url' = 'hex',
): string {
  switch (format) {
    case 'hex':
      return hashValueToHex(value)
    case 'base64':
    case 'base64url':
      return hashValueToBase64(value, format)
    default:
      throw new Error(`Unsupported hash format: ${format}`)
  }
}