/**
 * Build-time constant injected by Bun: `true` in the compiled binary (see
 * `scripts/build.ts`) and `false` for dev/test via `bunfig.toml`'s `[define]`.
 */
declare const IS_BINARY: boolean

declare type JsonPrimitive = string | number | boolean | null
declare type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

declare type Constructor<T = unknown> = new (...args: any[]) => T

declare type Primitive =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined