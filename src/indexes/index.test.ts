import { describe, expect, test } from 'bun:test'
import { type Index, type IndexRecord, isIndex, parseIndex } from './index'

const validMetadata: NonNullable<IndexRecord['metadata']> = {
  type: 'tools',
  priority: 2,
  revision: 1n,
  enabled: true,
  token: Symbol('token'),
  optional: null,
  omitted: undefined,
  labels: [
    'typescript',
    'typescript',
    3,
    4n,
    false,
    Symbol('label'),
    null,
    undefined,
  ],
}

const validRecord: IndexRecord = {
  metadata: validMetadata,
  description: 'Repository root',
  include: [],
  exclude: [],
  outputDirectory: 'generated/tools',
}

const validRecordWithoutMetadata: IndexRecord = {
  description: 'Repository root',
  include: [],
  exclude: [],
  outputDirectory: 'generated/tools',
}

describe('Index', () => {
  test('validates Index records and GitHub slug keys', () => {
    const index: Index = {
      repos: {
        'owner/repo': validRecord,
        'owner/repo/path/to/directory': {
          metadata: {},
          description: 'TypeScript templates',
          include: ['**/*.ts'],
          exclude: [],
          outputDirectory: 'templates',
        },
      },
    }

    expect(isIndex(index)).toBe(true)
    expect(
      isIndex({
        repos: {
          owner: validRecord,
        },
      }),
    ).toBe(false)
    expect(isIndex({ repos: [] })).toBe(false)
  })

  test('accepts a record when metadata is omitted', () => {
    expect(
      isIndex({ repos: { 'owner/repo': validRecordWithoutMetadata } }),
    ).toBe(true)

    expect(
      parseIndex(
        `repos:
  owner/repo:
    description: Repository root
    include: []
    exclude: []
    outputDirectory: generated/tools
`,
        'owner/repo/index.yaml',
      ),
    ).toEqual({ repos: { 'owner/repo': validRecordWithoutMetadata } })
  })

  test.each([
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['Set', new Set()],
    ['RegExp', /repos/],
  ])('rejects a %s repos container', (_, repos) => {
    expect(isIndex({ repos })).toBe(false)
  })

  test('accepts records and metadata mappings with null prototypes', () => {
    const repos: Index['repos'] = Object.create(null)
    const metadata: NonNullable<IndexRecord['metadata']> = Object.create(null)
    metadata.type = 'tools'
    repos['owner/repo'] = { ...validRecord, metadata }

    expect(isIndex({ repos })).toBe(true)
  })

  test('accepts every primitive metadata value and arrays of primitives', () => {
    expect(isIndex({ repos: { 'owner/repo': validRecord } })).toBe(true)
    expect(Array.isArray(validMetadata.labels)).toBe(true)
    expect(Object.getPrototypeOf(validMetadata)).toBe(Object.prototype)
  })

  test.each([
    ['a nested object', { nested: { value: 'no' } }],
    ['an object in an array', { nested: ['yes', { value: 'no' }] }],
    ['a nested array', { nested: [['no']] }],
    ['a function', { value: () => undefined }],
  ])('rejects metadata containing %s', (_, metadata) => {
    expect(
      isIndex({
        repos: { 'owner/repo': { ...validRecord, metadata } },
      }),
    ).toBe(false)
  })

  test('parses without deduplicating, reordering, or normalizing fields', () => {
    const parsed = parseIndex(
      `repos:
  'owner/repo/  src  ':
    metadata:
      type: ' duplicated type '
      labels: ['same', 'same']
      enabled: true
      priority: 2
      optional: null
    description: '  description preserved  '
    include: ['**/*.ts', '**/*.ts']
    exclude: []
    outputDirectory: '  generated src  '
  owner/repo/src:
    metadata: {}
    description: second
    include: []
    exclude: []
    outputDirectory: src
`,
      'owner/repo/index.yaml',
    )

    expect(parsed).toEqual({
      repos: {
        'owner/repo/  src  ': {
          metadata: {
            type: ' duplicated type ',
            labels: ['same', 'same'],
            enabled: true,
            priority: 2,
            optional: null,
          },
          description: '  description preserved  ',
          include: ['**/*.ts', '**/*.ts'],
          exclude: [],
          outputDirectory: '  generated src  ',
        },
        'owner/repo/src': {
          metadata: {},
          description: 'second',
          include: [],
          exclude: [],
          outputDirectory: 'src',
        },
      },
    })

    expect(Object.keys(parsed.repos)).toEqual([
      'owner/repo/  src  ',
      'owner/repo/src',
    ])
  })

  test.each([
    [
      'non-record metadata',
      {
        metadata: [],
        description: '',
        include: [],
        exclude: [],
        outputDirectory: '',
      },
    ],
    [
      'metadata explicitly set to undefined',
      {
        metadata: undefined,
        description: '',
        include: [],
        exclude: [],
        outputDirectory: '',
      },
    ],
    [
      'missing outputDirectory',
      { metadata: {}, description: '', include: [], exclude: [] },
    ],
    [
      'non-string outputDirectory',
      {
        metadata: {},
        description: '',
        include: [],
        exclude: [],
        outputDirectory: 1,
      },
    ],
    [
      'missing description',
      { metadata: {}, include: [], exclude: [], outputDirectory: '' },
    ],
    [
      'non-string description',
      {
        metadata: {},
        description: null,
        include: [],
        exclude: [],
        outputDirectory: '',
      },
    ],
  ])('rejects records with %s', (_, record) => {
    expect(isIndex({ repos: { 'owner/repo': record } })).toBe(false)
  })

  test('rejects invalid YAML and invalid Index structure contextually', () => {
    expect(() => parseIndex('repos: [', 'owner/repo/index.yaml')).toThrow(
      'Index owner/repo/index.yaml is not valid YAML',
    )
    expect(() =>
      parseIndex('repos: {}\nextra: preserved\n', 'index.yaml'),
    ).not.toThrow()
    expect(() => parseIndex('{}', 'owner/repo/index.yaml')).toThrow(
      'Index owner/repo/index.yaml does not have the expected structure.',
    )
  })
})