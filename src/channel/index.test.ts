import { describe, expect, test } from 'bun:test'
import { WorkerPool } from './index'

type Job = { value: number }
type Result = { input: number; output: number }

const workerPath = new URL('./worker.fixture.ts', import.meta.url).href

async function collectResults(pool: WorkerPool<Job, Result>) {
  const results: Result[] = []
  for await (const result of pool.results) results.push(result)
  return results
}

describe('WorkerPool', () => {
  test('processes every sent value and closes its results after the workers finish', async () => {
    const pool = new WorkerPool<Job, Result>(workerPath, { concurrency: 2 })

    const sending = (async () => {
      for (const value of [1, 2, 3, 4, 5, 6]) await pool.send({ value })
      await pool.close()
    })()

    const results = await collectResults(pool)
    await sending

    expect(
      results
        .map(({ input, output }) => ({ input, output }))
        .sort((left, right) => left.input - right.input),
    ).toEqual([
      { input: 1, output: 1 },
      { input: 2, output: 4 },
      { input: 3, output: 9 },
      { input: 4, output: 16 },
      { input: 5, output: 25 },
      { input: 6, output: 36 },
    ])
  })

  test('preserves duplicate jobs while applying input backpressure', async () => {
    const pool = new WorkerPool<Job, Result>(workerPath, {
      concurrency: 1,
      inputBufferSize: 1,
    })

    const sending = (async () => {
      for (const value of [3, 3, 2]) await pool.send({ value })
      await pool.close()
    })()

    const results = await collectResults(pool)
    await sending

    expect(results).toEqual([
      { input: 3, output: 9 },
      { input: 3, output: 9 },
      { input: 2, output: 4 },
    ])
  })

  test('makes worker options available through environment data', async () => {
    const pool = new WorkerPool<Job, Result>(workerPath, {
      concurrency: 1,
      workerOptions: { multiplier: 10 },
    })

    await pool.send({ value: 3 })
    const closing = pool.close()
    const results = await collectResults(pool)
    await closing

    expect(results).toEqual([{ input: 3, output: 30 }])
  })
})