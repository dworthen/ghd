import { getEnvironmentData } from 'node:worker_threads'

type Job = { value: number }
type Result = { input: number; output: number }
type WorkerOptions = { multiplier?: number }

declare const self: Worker
const options = getEnvironmentData('options') as WorkerOptions

self.onmessage = (event: MessageEvent<Job>) => {
  const input = event.data.value
  self.postMessage({
    input,
    output: input * (options.multiplier ?? input),
  } satisfies Result)
}