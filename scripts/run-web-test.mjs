/** Exercise the built plugin against a separate, unmodified official DSH checkout. */
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const harness = process.env.DSH_TEST_HARNESS
if (harness === undefined) throw new Error('Set DSH_TEST_HARNESS to a separately cloned, built official DSH 0.2.1-rc.2 checkout.')
const test = resolve(harness, 'apps/web/tests/community-annotations.e2e.ts')
await writeFile(test, await readFile(resolve(root, 'tests/integration/annotations.web.ts')), { flag: 'wx' })
try {
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.web.config.ts', test, ...process.argv.slice(2)], {
    cwd: harness, stdio: 'inherit', env: { ...process.env, DSH_ANNOTATIONS_PACKAGE: process.env.DSH_ANNOTATIONS_PACKAGE ?? root },
  })
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept) })
  process.exitCode = code === 0 ? 0 : 1
} finally { await unlink(test) }
