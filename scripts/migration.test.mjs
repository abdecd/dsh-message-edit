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
  const sessionSource = source({ running: false })
  const list = source({ byId: { source: {}, child: { parentId: 'source' } } })
  const projection = source({ next })
  const opened = []
  const entries = []
  const effects = []
  plugin.apply({
    sessions: {
      list,
      binding: () => ({
        eventSource,
        session: {
          projections: { faceOf: () => projection },
          getSnapshot: () => sessionSource.getSnapshot(),
          subscribe: fn => sessionSource.subscribe(fn),
        },
      }),
      open: id => opened.push(id),
    },
    slots: { register: entry => entries.push(entry) },
    on() {},
    effect(fn) { const dispose = fn(); effects.push(dispose); return async () => dispose() },
  })
  const face = entries[0].inject('source')
  assert.equal(entries[1].inject('source'), face)
  const release = face.acquire()
  return { face, requests, eventSource, sessionSource, list, opened, externals, release, effects }
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

test('running session defers revision-triggered timeline refresh until turn finishes', async () => {
  const f = await clientFixture({ provider: 'provider', model: 'model' })
  try {
    f.face.load()
    await settle()
    const count = f.requests.length

    // Start running
    f.sessionSource.set({ running: true })
    await settle()
    assert.equal(f.requests.length, count)

    // Streaming tokens bump revision repeatedly while running
    f.eventSource.set({ revision: 1 })
    f.eventSource.set({ revision: 2 })
    f.eventSource.set({ revision: 3 })
    await settle()
    // No extra request should have been sent while running
    assert.equal(f.requests.length, count)

    // Turn completes: session is no longer running
    f.sessionSource.set({ running: false })
    await settle()
    // Exactly one refresh request sent after turn finishes
    assert.equal(f.requests.length, count + 1)
  } finally { f.release() }
})

test('background load does not flip status from ready to loading', async () => {
  const f = await clientFixture({ provider: 'provider', model: 'model' })
  try {
    f.face.load()
    await settle()
    assert.equal(f.face.hooks.messageEdit.getSnapshot().status, 'ready')

    // Trigger background load
    const loadPromise = f.face.load()
    // Status should remain ready, not drop to loading
    assert.equal(f.face.hooks.messageEdit.getSnapshot().status, 'ready')
    await loadPromise
    assert.equal(f.face.hooks.messageEdit.getSnapshot().status, 'ready')
  } finally { f.release() }
})

test('retry before manual load completes automatically loads and executes', async () => {
  const f = await clientFixture({ provider: 'provider', model: 'model' })
  try {
    // We do not call f.face.load() beforehand, status is 'idle'
    assert.equal(f.face.hooks.messageEdit.getSnapshot().status, 'idle')

    // Calling reroll/retry should auto-load and succeed
    const success = await f.face.reroll()
    assert.equal(success, true)
    assert.deepEqual(f.opened, ['child'])
  } finally { f.release() }
})
