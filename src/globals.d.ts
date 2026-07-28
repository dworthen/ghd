/**
 * Build-time constant injected by Bun: `true` in the compiled binary (see
 * `scripts/build.ts`) and `false` for dev/test via `bunfig.toml`'s `[define]`.
 */
declare const IS_BINARY: boolean

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

type Constructor<T = {}> = new (...args: any[]) => T

export type Primitive =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined