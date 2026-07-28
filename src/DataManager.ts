export interface DataReader<T extends JsonValue> {
  read(): Promise<T> | T
}

export interface DataWriter {
  save(throwIfExists?: boolean, saveEmpty?: boolean): Promise<void> | void
}

export interface DataValidator {
  validate(): Promise<void> | void
}