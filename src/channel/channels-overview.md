# Go-style fan-out/fan-in with Bun workers

Bun's `Worker` is the goroutine-like part: it runs TypeScript on another thread and exchanges structured-cloned messages with the parent. A small async queue can provide channel-like coordination in the parent process.

This is the general pattern, not production-ready infrastructure: use a positive integer concurrency, send structured-cloneable values, and have each job produce exactly one reply. Worker crashes or protocol violations can leave the result loop waiting; cancellation, backpressure, retries, error propagation, and transferable objects are intentionally omitted.

## Channel and worker pool

```ts
// pool.ts
type StructuredCloneablePrimitive =
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
  | BigUint64Array;

type StructuredCloneable =
  | StructuredCloneablePrimitive
  | Array<StructuredCloneable>
  | ReadonlyArray<StructuredCloneable>
  | Map<StructuredCloneable, StructuredCloneable>
  | Set<StructuredCloneable>
  | { [key: string]: StructuredCloneable };

class Channel<T extends StructuredClobeable> implements AsyncIterable<T> {
  #values: T[] = [];
  #receivers: Array<(item: IteratorResult<T>) => void> = [];
  #closed = false;

  send(value: T) {
    if (this.#closed) throw new Error("channel is closed");

    const receive = this.#receivers.shift();
    if (receive) receive({ value, done: false });
    else this.#values.push(value);
  }

  receive(): Promise<IteratorResult<T>> {
    if (this.#values.length) {
      return Promise.resolve({ value: this.#values.shift() as T, done: false });
    }
    if (this.#closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => this.#receivers.push(resolve));
  }

  close() {
    this.#closed = true;
    for (const receive of this.#receivers.splice(0)) {
      receive({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.receive() };
  }
}

class WorkerPool<
  Input extends StructuredClobeable,
  Output extends StructuredClobeable,
> {
  #jobs = new Channel<Input>();
  readonly results = new Channel<Output>();
  #workers: Worker[];
  #done: Promise<void>;

  constructor(workerPath: string, concurrency: number) {
    this.#workers = Array.from(
      { length: concurrency },
      () => new Worker(workerPath),
    );

    this.#done = Promise.all(
      this.#workers.map((worker) => this.#run(worker)),
    ).then(() => this.results.close());
  }

  send(job: Input) {
    this.#jobs.send(job);
  }

  close() {
    this.#jobs.close();
    return this.#done;
  }

  async #run(worker: Worker) {
    for await (const job of this.#jobs) {
      const result = new Promise<Output>((resolve) => {
        worker.onmessage = (event) => resolve(event.data as Output);
      });

      worker.postMessage(job);
      this.results.send(await result);
    }

    worker.terminate();
  }
}
```

Every worker loop competes to receive from the same job channel. A busy worker waits for its reply before receiving again, so the next queued job naturally goes to whichever worker becomes available. All loops send into one results channel, giving fan-in in completion order.

## Worker function

```ts
// square.worker.ts
declare var self: Worker;

type Job = { value: number };
type Result = { input: number; output: number };

self.onmessage = (event: MessageEvent<Job>) => {
  const input = event.data.value;
  self.postMessage({ input, output: input * input } satisfies Result);
};
```

## Fan out, then fan in

```ts
// main.ts
const pool = new WorkerPool<
  { value: number },
  { input: number; output: number }
>("./square.worker.ts", 4);

for (const value of [1, 2, 3, 4, 5, 6]) pool.send({ value });
void pool.close(); // no more jobs; results stays open until every worker finishes

for await (const result of pool.results) {
  console.log(result);
}
```

The correspondence is:

- `new Worker(...)` → start a goroutine-like concurrent worker
- `Channel<Input>` → shared work channel (fan-out)
- one receive loop per worker → competing consumers
- `Channel<Output>` → merged result channel (fan-in)
- `close()` → signal that no more work will be sent

Bun resolves worker paths relative to the project root, supports TypeScript workers without a build step, and uses the structured clone algorithm for messages. See the [Bun Workers documentation](https://bun.com/docs/runtime/workers).
