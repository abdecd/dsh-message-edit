import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { run, withDshEnvironment } from './dsh-env.mjs'

await withDshEnvironment(async ({ dshRoot, pluginRoot }) => {
  const dist = join(pluginRoot, 'dist')
  await rm(dist, { recursive: true, force: true })
  await run(join(dshRoot, 'node_modules/.bin/tsc'), ['-b', 'tsconfig.json'])
  await run(join(dshRoot, 'node_modules/.bin/tsdown'), ['--config', 'tsdown.config.ts'])
  await copyFile(join(dist, 'index.js'), join(pluginRoot, 'index.mjs'))
  await copyFile(join(dist, 'client.js'), join(pluginRoot, 'client.js'))
  await copyFile(join(dist, 'client.js.map'), join(pluginRoot, 'client.js.map'))
  await rm(dist, { recursive: true, force: true })
})
