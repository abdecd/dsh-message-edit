import assert from 'node:assert/strict'
import test from 'node:test'
import * as messageEdit from '../index.mjs'

test('retry resolves the durable event mapping rather than a rendered turn position', () => {
  // A chat renderer may recycle a DOM seat showing turn 99, but an injected
  // button bound to event 11 must retry the timeline's turn 1 instead.
  const messages = [
    { eventSeq: 11, kind: 'user', turn: 1 },
    { eventSeq: 12, kind: 'user', turn: 99 },
  ]
  assert.equal(messageEdit.retryTurnForEvent(messages, 11), 1)
  assert.equal(messageEdit.retryTurnForEvent(messages, 12), 99)
  assert.equal(messageEdit.retryTurnForEvent(messages, 404), undefined)
})

test('retry does not inherit an already-pending inbox message', async () => {
  const user = {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
  }
  const events = [
    { type: 'agent/inbox/spliced', seq: 0, time: 1, data: { target: 'next-turn', start: 0, inserted: [user] } },
    { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: 3, data: user, surfaceOp: 'append' },
    { type: 'request/header', seq: 3, time: 4, data: { header: { config: { provider: 'provider', model: 'model' } } } },
    {
      type: 'assistant/message', seq: 4, time: 5,
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'old' }], source: { kind: 'model', provider: 'provider', model: 'model' } } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 5, time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  let routeHandler
  let created
  const followups = []
  const sourceSession = {
    id: 'source',
    header: { id: 'source', version: 3, createdAt: 1, cwd: '/tmp' },
    snapshotEvents: () => events,
  }
  const sourceAgent = {
    session: sourceSession,
    options: { provider: 'provider', model: 'model' },
    runMaintenance: async fn => fn(sourceAgent),
  }
  const childSession = {
    id: 'child',
    header: { id: 'child', version: 3, createdAt: 2 },
    events: [],
    append(type, data) {
      this.events.push({ type, data })
    },
    snapshotEvents() { return this.events },
  }
  const ctx = {
    effect: fn => fn(),
    webServer: { register: entry => { routeHandler = entry.handler } },
    connection: { requestRejection: () => undefined },
    agents: {
      get: () => sourceAgent,
      create: async options => {
        created = options
        return {
          agent: {
            session: childSession,
            followup: message => followups.push(message),
          },
          dispose: async () => {},
        }
      },
    },
    sessions: { flush: async () => {} },
    workspaceRegistry: { list: () => [] },
    get: () => undefined,
  }
  messageEdit.apply(ctx)
  const request = {
    method: 'POST',
    url: '/message-edit',
    headers: { host: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data') listener(Buffer.from(JSON.stringify({
        action: 'retry', sessionId: 'source', turn: 1, cascade: 'truncate',
        route: { provider: 'selected-provider', model: 'selected-model', reasoningEffort: 'high' },
      })))
      if (event === 'end') queueMicrotask(listener)
    },
  }
  let status
  let body
  await routeHandler(request, {
    writeHead: value => { status = value },
    end: value => { body = JSON.parse(value) },
  })
  assert.equal(status, 200, JSON.stringify(body))
  assert.deepEqual(created.agentOptions, {
    provider: 'selected-provider', model: 'selected-model', reasoningEffort: 'high',
  })
  assert.ok(Array.isArray(created.seed))
  assert.equal(created.seed.some(event => event.type === 'agent/inbox/spliced'), false)
  assert.equal(created.seed.find(event => event.type === 'message-edit/version')?.ignorable, true)
  assert.equal(followups.length, 1)
  assert.equal(followups[0].content[0].text, 'hello')
  assert.equal(childSession.events.length, 0)
})

test('timeline handles multi-generation lineage with inherited version events', async () => {
  const rootHeader = {
    id: 'session-root',
    version: 0,
    createdAt: 1000,
    isSeeded: false,
  }
  const child1Header = {
    id: 'session-child-1',
    version: 0,
    createdAt: 2000,
    parentSession: 'session-root',
    isSeeded: true,
  }
  const child2Header = {
    id: 'session-child-2',
    version: 0,
    createdAt: 3000,
    parentSession: 'session-child-1',
    isSeeded: true,
  }

  const rootEvents = [
    { type: 'user/message', seq: 0, time: 1010, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } },
    { type: 'assistant/chunk', seq: 1, time: 1020, data: { text: 'hi' } },
    { type: 'step/end', seq: 2, time: 1030, data: {} },
    { type: 'turn/end', seq: 3, time: 1040, data: {} },
  ]

  const child1Events = [
    ...rootEvents,
    {
      type: 'message-edit/version',
      seq: 4,
      time: 2010,
      data: {
        schemaVersion: 2,
        effect: {
          id: 'effect-1',
          operation: 'retry',
          cascade: 'truncate',
          targetTurn: 0,
          targetEventSeq: 3,
        },
        inverse: { kind: 'restore-version', sessionId: 'session-root' },
      },
      ignorable: true,
    },
    { type: 'assistant/chunk', seq: 5, time: 2020, data: { text: 'reply 1' } },
    { type: 'step/end', seq: 6, time: 2030, data: {} },
    { type: 'turn/end', seq: 7, time: 2040, data: {} },
  ]

  // Child 2 inherits child 1's events (including seq 4!), and appends its own at seq 8.
  const child2Events = [
    ...child1Events,
    {
      type: 'message-edit/version',
      seq: 8,
      time: 3010,
      data: {
        schemaVersion: 2,
        effect: {
          id: 'effect-2',
          operation: 'retry',
          cascade: 'truncate',
          targetTurn: 0,
          targetEventSeq: 7,
        },
        inverse: { kind: 'restore-version', sessionId: 'session-child-1' },
      },
      ignorable: true,
    },
    { type: 'assistant/chunk', seq: 9, time: 3020, data: { text: 'reply 2' } },
    { type: 'step/end', seq: 10, time: 3030, data: {} },
    { type: 'turn/end', seq: 11, time: 3040, data: {} },
  ]

  const store = {
    'session-root': { events: rootEvents, inheritedEventCount: 0, meta: rootHeader },
    'session-child-1': { events: child1Events, inheritedEventCount: 4, meta: child1Header },
    'session-child-2': { events: child2Events, inheritedEventCount: 8, meta: child2Header },
  }

  let routeHandler
  const ctx = {
    effect: (fn) => fn(),
    webServer: {
      register: (entry) => { routeHandler = entry.handler },
    },
    connection: {
      requestRejection: () => undefined,
    },
    sessionQuery: {
      traceSession: async (sessionId) => {
        const records = [
          { header: rootHeader, live: false, persisted: true },
          { header: child1Header, live: false, persisted: true },
          { header: child2Header, live: false, persisted: true },
        ]
        return {
          complete: true,
          root: records[0],
          target: records.find(r => r.header.id === sessionId),
          ancestors: sessionId === 'session-child-2' ? [records[1], records[0]] : sessionId === 'session-child-1' ? [records[0]] : [],
          descendants: sessionId === 'session-root' ? [
            { session: records[1], descendants: [{ session: records[2], descendants: [] }] },
          ] : sessionId === 'session-child-1' ? [
            { session: records[2], descendants: [] },
          ] : [],
        }
      },
      readSession: async (sessionId) => {
        const item = store[sessionId]
        return { session: item.meta, inheritedEventCount: item.inheritedEventCount, events: item.events }
      },
    },
    sessions: {
      get: () => undefined,
      list: () => [],
      flush: async () => {},
    },
    workspaceRegistry: {
      list: () => [],
    },
    // RC2 exposes read-only SessionPersistence handles. The timeline must read
    // complete seeded logs through this API rather than sessionQuery.readSession,
    // which still reconstructs them with the snapshot-only constructor.
    get: service => service === 'sessionPersistence' ? {
      open: async sessionId => {
        const item = store[sessionId]
        return {
          inheritedEventCount: item.inheritedEventCount,
          read: async () => ({ events: item.events }),
          close: async () => {},
        }
      },
    } : undefined,
  }

  messageEdit.apply(ctx)

  // Make HTTP request for child-2 timeline
  const req = {
    method: 'GET',
    url: '/message-edit?sessionId=session-child-2',
    headers: { host: '127.0.0.1' },
    on: () => {},
  }
  let responseStatus
  let responseData
  const res = {
    writeHead: (status) => { responseStatus = status },
    end: (data) => { responseData = JSON.parse(data) },
  }

  await routeHandler(req, res)

  assert.equal(responseStatus, 200, `Expected 200, got ${responseStatus}: ${JSON.stringify(responseData)}`)
  assert.equal(responseData.sessionId, 'session-child-2')
  assert.equal(responseData.versions.length, 3)

  // Verify versions
  const v0 = responseData.versions.find(v => v.sessionId === 'session-root')
  const v1 = responseData.versions.find(v => v.sessionId === 'session-child-1')
  const v2 = responseData.versions.find(v => v.sessionId === 'session-child-2')

  assert.ok(v0 && v1 && v2)
  assert.equal(v0.effectId, undefined)
  assert.equal(v1.effectId, 'effect-1')
  assert.equal(v1.operation, 'retry')
  assert.equal(v2.effectId, 'effect-2')
  assert.equal(v2.operation, 'retry')
  assert.equal(v2.current, true)

  // Verify undo stack for child-2
  assert.deepEqual(responseData.undoStack, ['session-child-1', 'session-root'])
})

test('defensive recovery when inheritedEventCount is zero on multi-generation child', async () => {
  const rootHeader = { id: 'session-r', version: 0, createdAt: 100, isSeeded: false }
  const child1Header = { id: 'session-c1', version: 0, createdAt: 200, parentSession: 'session-r', isSeeded: true }
  const child2Header = { id: 'session-c2', version: 0, createdAt: 300, parentSession: 'session-c1', isSeeded: true }

  const rootEvents = [{ type: 'user/message', seq: 0, time: 101, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } }]
  const child1Events = [
    ...rootEvents,
    {
      type: 'message-edit/version',
      seq: 1,
      time: 201,
      data: {
        schemaVersion: 2,
        effect: { id: 'e1', operation: 'retry', cascade: 'truncate', targetTurn: 0, targetEventSeq: 0 },
        inverse: { kind: 'restore-version', sessionId: 'session-r' },
      },
      ignorable: true,
    },
  ]
  const child2Events = [
    ...child1Events,
    {
      type: 'message-edit/version',
      seq: 2,
      time: 301,
      data: {
        schemaVersion: 2,
        effect: { id: 'e2', operation: 'retry', cascade: 'truncate', targetTurn: 0, targetEventSeq: 1 },
        inverse: { kind: 'restore-version', sessionId: 'session-c1' },
      },
      ignorable: true,
    },
  ]

  // Simulate missing/zero inheritedEventCount
  const store = {
    'session-r': { events: rootEvents, inheritedEventCount: 0, meta: rootHeader },
    'session-c1': { events: child1Events, inheritedEventCount: 0, meta: child1Header },
    'session-c2': { events: child2Events, inheritedEventCount: 0, meta: child2Header },
  }

  let routeHandler
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (entry) => { routeHandler = entry.handler } },
    connection: { requestRejection: () => undefined },
    sessionQuery: {
      traceSession: async (sessionId) => {
        const records = [
          { header: rootHeader, live: false, persisted: true },
          { header: child1Header, live: false, persisted: true },
          { header: child2Header, live: false, persisted: true },
        ]
        return {
          complete: true,
          root: records[0],
          target: records.find(r => r.header.id === sessionId),
          ancestors: sessionId === 'session-c2' ? [records[1], records[0]] : [records[0]],
          descendants: sessionId === 'session-r' ? [
            { session: records[1], descendants: [{ session: records[2], descendants: [] }] },
          ] : sessionId === 'session-c1' ? [
            { session: records[2], descendants: [] },
          ] : [],
        }
      },
      readSession: async (sessionId) => {
        const item = store[sessionId]
        return { session: item.meta, inheritedEventCount: item.inheritedEventCount, events: item.events }
      },
    },
    sessions: { get: () => undefined, list: () => [], flush: async () => {} },
    workspaceRegistry: { list: () => [] },
    get: () => undefined,
  }

  messageEdit.apply(ctx)

  const req = { method: 'GET', url: '/message-edit?sessionId=session-c2', headers: { host: '127.0.0.1' }, on: () => {} }
  let responseStatus
  let responseData
  const res = {
    writeHead: (status) => { responseStatus = status },
    end: (data) => { responseData = JSON.parse(data) },
  }

  await routeHandler(req, res)
  assert.equal(responseStatus, 200, `Expected 200 even with 0 inheritedEventCount, got ${responseStatus}: ${JSON.stringify(responseData)}`)
  const v2 = responseData.versions.find(v => v.sessionId === 'session-c2')
  assert.equal(v2.effectId, 'e2')
})

test('rejects session when it genuinely has multiple own version events matching parent', async () => {
  const rootHeader = { id: 'session-r', version: 0, createdAt: 100, isSeeded: false }
  const childHeader = { id: 'session-c', version: 0, createdAt: 200, parentSession: 'session-r', isSeeded: true }

  const rootEvents = [{ type: 'user/message', seq: 0, time: 101, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } }]
  const childEvents = [
    ...rootEvents,
    {
      type: 'message-edit/version',
      seq: 1,
      time: 201,
      data: {
        schemaVersion: 2,
        effect: { id: 'e1', operation: 'retry', cascade: 'truncate', targetTurn: 0, targetEventSeq: 0 },
        inverse: { kind: 'restore-version', sessionId: 'session-r' },
      },
      ignorable: true,
    },
    {
      type: 'message-edit/version',
      seq: 2,
      time: 202,
      data: {
        schemaVersion: 2,
        effect: { id: 'e2', operation: 'retry', cascade: 'truncate', targetTurn: 0, targetEventSeq: 0 },
        inverse: { kind: 'restore-version', sessionId: 'session-r' },
      },
      ignorable: true,
    },
  ]

  const store = {
    'session-r': { events: rootEvents, inheritedEventCount: 0, meta: rootHeader },
    'session-c': { events: childEvents, inheritedEventCount: 1, meta: childHeader },
  }

  let routeHandler
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (entry) => { routeHandler = entry.handler } },
    connection: { requestRejection: () => undefined },
    sessionQuery: {
      traceSession: async (sessionId) => {
        const records = [
          { header: rootHeader, live: false, persisted: true },
          { header: childHeader, live: false, persisted: true },
        ]
        return {
          complete: true,
          root: records[0],
          target: records.find(r => r.header.id === sessionId),
          ancestors: [records[0]],
          descendants: sessionId === 'session-r' ? [{ session: records[1], descendants: [] }] : [],
        }
      },
      readSession: async (sessionId) => {
        const item = store[sessionId]
        return { session: item.meta, inheritedEventCount: item.inheritedEventCount, events: item.events }
      },
    },
    sessions: { get: () => undefined, list: () => [], flush: async () => {} },
    workspaceRegistry: { list: () => [] },
    get: () => undefined,
  }

  messageEdit.apply(ctx)

  const req = { method: 'GET', url: '/message-edit?sessionId=session-c', headers: { host: '127.0.0.1' }, on: () => {} }
  let responseStatus
  let responseData
  const res = {
    writeHead: (status) => { responseStatus = status },
    end: (data) => { responseData = JSON.parse(data) },
  }

  await routeHandler(req, res)
  assert.equal(responseStatus, 409)
  assert.match(responseData.error, /包含多个自身版本效果/)
})

