export interface FileManager<T extends JsonValue> {
  load(): Promise<T> | T
  save(throwIfExists?: boolean, saveEmpty?: boolean): Promise<void> | void
  validate(): Promise<void> | void
}