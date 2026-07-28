/**
 * Build-time constant injected by Bun: `true` in the compiled binary (see
 * `scripts/build.ts`) and `false` for dev/test via `bunfig.toml`'s `[define]`.
 */
declare const IS_BINARY: boolean

declare global {
  type JsonPrimitive = string | number | boolean | null
  type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
}