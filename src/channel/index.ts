import { availableParallelism } from 'node:os'
import { setEnvironmentData } from 'node:worker_threads'

export type StructuredCloneablePrimitive =
  | undefined
  | null
  | boolean
  | number
  | string
  | bigint
  | Date
  | RegExp
  | Blob
  | File
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

export type StructuredCloneable =
  | StructuredCloneablePrimitive
  | Array<StructuredCloneable>
  | ReadonlyArray<StructuredCloneable>
  | Map<StructuredCloneable, StructuredCloneable>
  | Set<StructuredCloneable>
  | { [key: string]: StructuredCloneable }

export class Channel<T extends StructuredCloneable>
  implements AsyncIterable<T>
{
  #buffer: T[] = []
  #bufferSize: number
  #receivers: Array<(item: IteratorResult<T>) => void> = []
  #closed = false

  constructor(bufferSize: number = Number.MAX_SAFE_INTEGER) {
    this.#bufferSize = bufferSize
  }

  async send(value: T): Promise<void> {
    if (this.#closed) throw new Error('channel is closed')

    const receive = this.#receivers.shift()
    if (receive) {
      receive({ value, done: false })
      return
    } else if (this.#buffer.length < this.#bufferSize) {
      this.#buffer.push(value)
      return
    }
    await new Promise<void>((resolve) => {
      const trySend = () => {
        const r = this.#receivers.shift()
        if (r) {
          r({ value, done: false })
          resolve()
        } else if (this.#buffer.length < this.#bufferSize) {
          this.#buffer.push(value)
          resolve()
        } else {
          setTimeout(trySend, 0)
        }
      }
      trySend()
    })
  }

  receive(): Promise<IteratorResult<T>> {
    if (this.#buffer.length) {
      return Promise.resolve({ value: this.#buffer.shift() as T, done: false })
    }
    if (this.#closed) {
      return Promise.resolve({ value: undefined, done: true })
    }
    return new Promise((resolve) => this.#receivers.push(resolve))
  }

  close() {
    this.#closed = true
    for (const receive of this.#receivers) {
      receive({ value: undefined, done: true })
    }
    // for (const receive of this.#receivers.splice(0)) {
    //   receive({ value: undefined, done: true })
    // }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.receive() }
  }
}

export type WorkerPoolOptions = {
  concurrency?: number
  inputBufferSize?: number
  outputBufferSize?: number
  workerOptions?: StructuredCloneable
}

export class WorkerPool<
  Input extends StructuredCloneable,
  Output extends StructuredCloneable,
> {
  #jobs: Channel<Input>
  readonly results: Channel<Output>
  #workers: Worker[]
  #done: Promise<void>

  constructor(workerPath: string, options: WorkerPoolOptions = {}) {
    const {
      concurrency = Math.max(availableParallelism() - 1, 1),
      inputBufferSize,
      outputBufferSize,
      workerOptions,
    } = options
    this.#jobs = new Channel<Input>(inputBufferSize)
    this.results = new Channel<Output>(outputBufferSize)

    setEnvironmentData('options', workerOptions ?? {})

    this.#workers = Array.from(
      { length: concurrency },
      () => new Worker(workerPath),
    )

    this.#done = Promise.all(
      this.#workers.map((worker) => this.#run(worker)),
    ).then(() => this.results.close())
  }

  async send(job: Input): Promise<void> {
    return await this.#jobs.send(job)
  }

  close(): Promise<void> {
    this.#jobs.close()
    return this.#done
  }

  async #run(worker: Worker) {
    for await (const job of this.#jobs) {
      const result = new Promise<Output>((resolve) => {
        worker.onmessage = (event) => resolve(event.data as Output)
      })

      worker.postMessage(job)
      await this.results.send(await result)
    }

    worker.terminate()
  }
}