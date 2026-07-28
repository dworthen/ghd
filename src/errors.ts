export class ValidationError extends Error {
  override name = 'ValidationError'
}

export class InvalidFileExtensionError extends Error {
  override name = 'InvalidFileExtensionError'
}

export class FileAlreadyExistsError extends Error {
  override name = 'FileAlreadyExistsError'
}

export class FileNotLoadedError extends Error {
  override name = 'FileNotLoadedError'
}