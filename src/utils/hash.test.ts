import { describe, expect, test } from 'bun:test'
import { hashStringToHex } from './hash'

describe('hashStringToHex', () => {
  test.each([
    ['', 'ef46db3751d8e999'],
    ['hello', '26c7827d889f6da3'],
    [
      'msr-central/deworthe-skills/.agents/skills/create-plan',
      'dbecff4c4d3682a7',
    ],
  ])('hashes %p with xxHash64 and returns lowercase hex', (value, expected) => {
    expect(hashStringToHex(value)).toBe(expected)
  })
})