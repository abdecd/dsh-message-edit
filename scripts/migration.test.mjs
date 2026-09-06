import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
function source(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const fn of listeners) fn() },
    get size() { return listeners.size },
  }
}
const timeline = { sessionId: 'source', messages: [], retryableTurns: [], versions: [], undoStack: [], redoSessionIds: [] }

async function clientFixture(next) {
  const requests = []
  let loaded
  const externals = []
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { loaded = value } } },
    AbortController, setTimeout, clearTimeout, console,
    fetch: async (url, options) => {
      requests.push({ url, ...options })
      return new Response(JSON.stringify(options.method === 'POST' ? { sessionId: 'child', queuedTurns: 1 } : timeline), { status: 200 })
    },
  }
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), sandbox)
  assert.equal(loaded.id, 'dsh-message-edit')
  const plugin = loaded.factory(id => { externals.push(id); return require(id) })
  const eventSource = source({ revision: 0 })
  const list = source({ byId: { source: {}, child: { parentId: 'source' } } })
  const projection = source({ next })
  const opened = []
  const entries = []
  const effects = []
  plugin.apply({
    sessions: {
      list,
      binding: () => ({ eventSource, session: { projections: { faceOf: () => projection } } }),
      open: id => opened.push(id),
    },
    slots: { register: entry => entries.push(entry) },
    on() {},
    effect(fn) { const dispose = fn(); effects.push(dispose); return async () => dispose() },
  })
  const face = entries[0].inject('source')
  assert.equal(entries[1].inject('source'), face)
  const release = face.acquire()
  return { face, requests, eventSource, list, opened, externals, release, effects }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 220))

test('built client uses shared store and forwards rc.1 modelSelection.next', async () => {
  const f = await clientFixture({ provider: 'provider', model: 'model', reasoningEffort: 'high' })
  try {
    f.face.load()
    await settle()
    assert.equal(await f.face.reroll(), true)
    assert.deepEqual(JSON.parse(f.requests.find(r => r.method === 'POST').body).route, { provider: 'provider', model: 'model', reasoningEffort: 'high' })
    assert.deepEqual(f.opened, ['child'])
    assert.ok(f.externals.includes('@deepseek-ai/dsh-client-store'))
    assert.ok(f.externals.every(id => !id.includes('dsh-client-runtime')))
  } finally { f.release() }
  assert.equal(f.eventSource.size, 0)
  assert.equal(f.list.size, 0)
})

test('event-window revisions invalidate timeline and absent effort stays absent', async () => {
  const f = await clientFixture({ provider: 'provider', model: 'model' })
  try {
    f.face.load()
    await settle()
    const count = f.requests.length
    f.eventSource.set({ revision: 1 })
    await settle()
    assert.equal(f.requests.length, count + 1)
    f.eventSource.set({ revision: 1 })
    await settle()
    assert.equal(f.requests.length, count + 1)
    assert.equal(await f.face.reroll(), true)
    assert.equal('reasoningEffort' in JSON.parse(f.requests.at(-1).body).route, false)
  } finally { f.release() }
})

test('absent composer projection keeps historical-route fallback', async () => {
  const f = await clientFixture(null)
  try {
    f.face.load()
    await settle()
    assert.equal(await f.face.reroll(), true)
    assert.equal('route' in JSON.parse(f.requests.at(-1).body), false)
  } finally { f.release() }
})

test('fork forwards the selected agent preset', async () => {
  const f = await clientFixture({ provider: 'provider', model: 'model' })
  try {
    f.face.load()
    await settle()
    assert.equal(await f.face.fork([], undefined, 'standard'), true)
    const request = f.requests.find(item => item.method === 'POST')
    assert.ok(request)
    assert.equal(JSON.parse(request.body).agentPreset, 'standard')
  } finally { f.release() }
})
