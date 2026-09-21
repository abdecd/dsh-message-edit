import assert from 'node:assert/strict'
import test from 'node:test'
import { foldSurface } from '@deepseek-ai/dsh-session'
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

test('timeline correctly identifies compaction node and extracts clean summary text and token stats', async () => {
  const compactionHeader = { id: 'session-cmp', version: 3, createdAt: 100 }
  const compactionEvents = [
    { type: 'turn/start', seq: 0, time: 101, data: { turn: 1 } },
    {
      type: 'user/message', seq: 1, time: 102,
      data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Hello 1' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    { type: 'request/header', seq: 2, time: 103, data: { header: { config: { provider: 'test-p', model: 'test-m' } } } },
    {
      type: 'assistant/message', seq: 3, time: 104,
      data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Reply 1' }], source: { kind: 'model', provider: 'test-p', model: 'test-m' } } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 4, time: 105, data: { turn: 1, reason: { kind: 'completed' } } },
    {
      type: 'compaction/start', seq: 5, time: 106,
      data: { compactionId: 'cmp-123', turn: null },
    },
    {
      type: 'compaction/summary', seq: 6, time: 107,
      data: {
        compactionId: 'cmp-123',
        summary: [{ type: 'text', text: 'Clean summary of earlier conversation.' }],
        shadowedRange: { start: 1, end: 3 },
        shadowedSeqs: [1, 3],
        shadowedTokenCount: 150,
        provider: 'test-p',
        model: 'test-m',
      },
    },
    {
      type: 'user/message', seq: 7, time: 108,
      data: {
        id: 'u-cmp',
        role: 'user',
        content: [{ type: 'text', text: 'This is an automatically generated checkpoint...\n\n<summary>\nClean summary of earlier conversation.\n</summary>' }],
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'cmp-123' },
      },
      surfaceOp: { op: 'replace', startSeq: 1, endSeq: 3 },
      sourceEventSeqs: [5, 6, 1, 3],
    },
    {
      type: 'compaction/end', seq: 8, time: 109,
      data: { compactionId: 'cmp-123', turn: null },
    },
    { type: 'turn/start', seq: 9, time: 110, data: { turn: 2 } },
    {
      type: 'user/message', seq: 10, time: 111,
      data: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Hello 2' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    {
      type: 'assistant/message', seq: 11, time: 112,
      data: { turn: 2, step: 1, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Reply 2' }], source: { kind: 'model', provider: 'test-p', model: 'test-m' } } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 12, time: 113, data: { turn: 2, reason: { kind: 'completed' } } },
  ]

  let routeHandler
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (entry) => { routeHandler = entry.handler } },
    connection: { requestRejection: () => undefined },
    sessionQuery: {
      traceSession: async () => ({
        complete: true,
        root: { header: compactionHeader, live: false, persisted: true },
        target: { header: compactionHeader, live: false, persisted: true },
        ancestors: [],
        descendants: [],
      }),
      readSession: async () => ({
        session: compactionHeader,
        inheritedEventCount: 0,
        events: compactionEvents,
      }),
    },
    sessions: { get: () => undefined, list: () => [], flush: async () => {} },
    workspaceRegistry: { list: () => [] },
    get: () => undefined,
  }

  messageEdit.apply(ctx)

  const req = { method: 'GET', url: '/message-edit?sessionId=session-cmp', headers: { host: '127.0.0.1' }, on: () => {} }
  let responseStatus
  let responseData
  const res = {
    writeHead: (status) => { responseStatus = status },
    end: (data) => { responseData = JSON.parse(data) },
  }

  await routeHandler(req, res)
  assert.equal(responseStatus, 200)

  const kinds = responseData.messages.map(m => m.kind)
  assert.deepEqual(kinds, ['user', 'assistant.response', 'compaction', 'user', 'assistant.response'])

  const compactionMsg = responseData.messages.find(m => m.kind === 'compaction')
  assert.ok(compactionMsg, 'Compaction message block should exist')
  assert.equal(compactionMsg.text, 'Clean summary of earlier conversation.')
  assert.equal(compactionMsg.compactionId, 'cmp-123')
  assert.equal(compactionMsg.shadowedItemCount, 2)
  assert.equal(compactionMsg.shadowedTokenCount, 150)
  assert.equal(compactionMsg.turn, 1, 'Manual compaction after turn 1 should stay with turn 1')

  const retryable = responseData.retryableTurns
  assert.equal(retryable.length, 2)
  assert.equal(retryable[0].turn, 1)
  assert.equal(retryable[1].turn, 2)
})

test('fork correctly handles compaction nodes and properly shadows prior surface nodes', async () => {
  const sourceHeader = { id: 'source-fork-cmp', version: 3, createdAt: 1, cwd: '/tmp' }
  const sourceEvents = [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    {
      type: 'user/message', seq: 1, time: 11,
      data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Old prompt' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    { type: 'request/header', seq: 2, time: 12, data: { header: { config: { provider: 'test-p', model: 'test-m' } } } },
    {
      type: 'assistant/message', seq: 3, time: 13,
      data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Old reply' }], source: { kind: 'model', provider: 'test-p', model: 'test-m' } } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 4, time: 14, data: { turn: 1, reason: { kind: 'completed' } } },
    {
      type: 'compaction/start', seq: 5, time: 15,
      data: { compactionId: 'cmp-orig', turn: 1 },
    },
    {
      type: 'compaction/summary', seq: 6, time: 16,
      data: {
        compactionId: 'cmp-orig',
        summary: [{ type: 'text', text: 'Original summary' }],
        shadowedRange: { start: 1, end: 3 },
        shadowedSeqs: [1, 3],
        shadowedTokenCount: 100,
        provider: 'test-p',
        model: 'test-m',
      },
    },
    {
      type: 'user/message', seq: 7, time: 17,
      data: {
        id: 'u-cmp',
        role: 'user',
        content: [{ type: 'text', text: 'This is an automatically generated checkpoint...\n\n<summary>\nOriginal summary\n</summary>' }],
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'cmp-orig' },
      },
      surfaceOp: { op: 'replace', startSeq: 1, endSeq: 3 },
      sourceEventSeqs: [5, 6, 1, 3],
    },
    {
      type: 'compaction/end', seq: 8, time: 18,
      data: { compactionId: 'cmp-orig', turn: 1 },
    },
  ]

  let routeHandler
  let created
  const followups = []
  const sourceSession = {
    id: 'source-fork-cmp',
    header: sourceHeader,
    snapshotEvents: () => sourceEvents,
  }
  const sourceAgent = {
    session: sourceSession,
    options: { provider: 'test-p', model: 'test-m' },
    runMaintenance: async fn => fn(sourceAgent),
  }
  const childSession = {
    id: 'child-fork-cmp',
    header: { id: 'child-fork-cmp', version: 3, createdAt: 20 },
    events: [],
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

  const forkPayload = {
    action: 'fork',
    sessionId: 'source-fork-cmp',
    rows: [
      { kind: 'user', text: 'Old prompt', sourceEventSeq: 1 },
      { kind: 'assistant.response', text: 'Old reply', sourceEventSeq: 3 },
      { kind: 'compaction', text: 'Edited summary text', compactionId: 'cmp-orig', sourceEventSeq: 7 },
      { kind: 'user', text: 'New prompt after compaction' },
    ],
  }

  const req = {
    method: 'POST',
    url: '/message-edit',
    headers: { host: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data') listener(Buffer.from(JSON.stringify(forkPayload)))
      if (event === 'end') queueMicrotask(listener)
    },
  }

  let status
  let body
  await routeHandler(req, {
    writeHead: value => { status = value },
    end: value => { body = JSON.parse(value) },
  })

  assert.equal(status, 200, JSON.stringify(body))
  assert.ok(created, 'Child agent should be created')

  // Check seed events
  const seed = created.seed
  const seedTypes = seed.map(e => e.type)
  assert.ok(seedTypes.includes('compaction/start'), 'Seed should include compaction/start')
  assert.ok(seedTypes.includes('compaction/summary'), 'Seed should include compaction/summary')
  assert.ok(seedTypes.includes('compaction/end'), 'Seed should include compaction/end')

  // Verify the compaction user/message has replace surfaceOp
  const cmpUserEvent = seed.find(e => e.type === 'user/message' && e.data.source?.plugin === 'compact')
  assert.ok(cmpUserEvent, 'Compaction checkpoint user/message should exist in seed')
  assert.equal(typeof cmpUserEvent.surfaceOp, 'object')
  assert.equal(cmpUserEvent.surfaceOp.op, 'replace')
  assert.ok(cmpUserEvent.data.content[0].text.includes('Edited summary text'))

  // Verify trailing user is queued as followup
  assert.equal(followups.length, 1)
  assert.equal(followups[0].content[0].text, 'New prompt after compaction')
})

test('edit operation on compaction node updates summary and rebuilds compaction', async () => {
  const sourceHeader = { id: 'source-edit-cmp', version: 3, createdAt: 1, cwd: '/tmp' }
  const sourceEvents = [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    {
      type: 'user/message', seq: 1, time: 11,
      data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Old prompt' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    { type: 'request/header', seq: 2, time: 12, data: { header: { config: { provider: 'test-p', model: 'test-m' } } } },
    {
      type: 'assistant/message', seq: 3, time: 13,
      data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Old reply' }], source: { kind: 'model', provider: 'test-p', model: 'test-m' } } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 4, time: 14, data: { turn: 1, reason: { kind: 'completed' } } },
    {
      type: 'compaction/start', seq: 5, time: 15,
      data: { compactionId: 'cmp-orig', turn: 1 },
    },
    {
      type: 'compaction/summary', seq: 6, time: 16,
      data: {
        compactionId: 'cmp-orig',
        summary: [{ type: 'text', text: 'Original summary' }],
        shadowedRange: { start: 1, end: 3 },
        shadowedSeqs: [1, 3],
        shadowedTokenCount: 100,
        provider: 'test-p',
        model: 'test-m',
      },
    },
    {
      type: 'user/message', seq: 7, time: 17,
      data: {
        id: 'u-cmp',
        role: 'user',
        content: [{ type: 'text', text: 'This is an automatically generated checkpoint...\n\n<summary>\nOriginal summary\n</summary>' }],
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'cmp-orig' },
      },
      surfaceOp: { op: 'replace', startSeq: 1, endSeq: 3 },
      sourceEventSeqs: [5, 6, 1, 3],
    },
    {
      type: 'compaction/end', seq: 8, time: 18,
      data: { compactionId: 'cmp-orig', turn: 1 },
    },
    { type: 'turn/start', seq: 9, time: 19, data: { turn: 2 } },
    {
      type: 'user/message', seq: 10, time: 20,
      data: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Followup prompt' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 11, time: 21, data: { turn: 2, reason: { kind: 'completed' } } },
  ]

  let routeHandler
  let created
  const followups = []
  const sourceSession = {
    id: 'source-edit-cmp',
    header: sourceHeader,
    snapshotEvents: () => sourceEvents,
  }
  const sourceAgent = {
    session: sourceSession,
    options: { provider: 'test-p', model: 'test-m' },
    runMaintenance: async fn => fn(sourceAgent),
  }
  const childSession = {
    id: 'child-edit-cmp',
    header: { id: 'child-edit-cmp', version: 3, createdAt: 30 },
    events: [],
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

  const editPayload = {
    action: 'edit',
    sessionId: 'source-edit-cmp',
    eventSeq: 7,
    blockIndex: 0,
    text: 'Newly revised summary',
    cascade: 'preserve',
  }

  const req = {
    method: 'POST',
    url: '/message-edit',
    headers: { host: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data') listener(Buffer.from(JSON.stringify(editPayload)))
      if (event === 'end') queueMicrotask(listener)
    },
  }

  let status
  let body
  await routeHandler(req, {
    writeHead: value => { status = value },
    end: value => { body = JSON.parse(value) },
  })

  assert.equal(status, 200, JSON.stringify(body))
  assert.ok(created, 'Child agent should be created')

  // Verify version effect metadata
  const versionEvent = created.seed.find(e => e.type === 'message-edit/version')
  assert.ok(versionEvent)
  assert.equal(versionEvent.data.effect.blockKind, 'compaction')
  assert.equal(versionEvent.data.effect.before, 'Original summary')
  assert.equal(versionEvent.data.effect.after, 'Newly revised summary')

  // Verify downstream user was preserved
  assert.equal(followups.length, 1)
  assert.equal(followups[0].content[0].text, 'Followup prompt')
})

test('compaction replacement includes intermediate system messages in sourceEventSeqs and satisfies foldSurface', async () => {
  const sourceHeader = { id: 'source-edit-sys-cmp', version: 3, createdAt: 1, cwd: '/tmp' }
  const sourceEvents = [
    {
      type: 'system/message', seq: 0, time: 9,
      data: { turn: 0, step: 0, message: { id: 'sys0', role: 'system', content: [{ type: 'text', text: 'System head' }] } },
      surfaceOp: 'append',
    },
    { type: 'turn/start', seq: 1, time: 10, data: { turn: 1 } },
    {
      type: 'user/message', seq: 2, time: 11,
      data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Prompt 1' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    { type: 'request/header', seq: 3, time: 12, data: { header: { config: { provider: 'test-p', model: 'test-m' } } } },
    {
      type: 'assistant/message', seq: 4, time: 13,
      data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Reply 1' }], source: { kind: 'model', provider: 'test-p', model: 'test-m' } } },
      surfaceOp: 'append',
    },
    {
      type: 'system/message', seq: 5, time: 14,
      data: { turn: 1, step: 2, message: { id: 'sys-mid-1', role: 'system', content: [{ type: 'text', text: 'Intermediate system prompt 1 (like 160)' }] } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 6, time: 15, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 7, time: 16, data: { turn: 2 } },
    {
      type: 'user/message', seq: 8, time: 17,
      data: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Prompt 2' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    {
      type: 'assistant/message', seq: 9, time: 18,
      data: { turn: 2, step: 1, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Reply 2' }], source: { kind: 'model', provider: 'test-p', model: 'test-m' } } },
      surfaceOp: 'append',
    },
    {
      type: 'system/message', seq: 10, time: 19,
      data: { turn: 2, step: 2, message: { id: 'sys-mid-2', role: 'system', content: [{ type: 'text', text: 'Intermediate system prompt 2 (like 251)' }] } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 11, time: 20, data: { turn: 2, reason: { kind: 'completed' } } },
    {
      type: 'compaction/start', seq: 12, time: 21,
      data: { compactionId: 'cmp-sys', turn: 2 },
    },
    {
      type: 'compaction/summary', seq: 13, time: 22,
      data: {
        compactionId: 'cmp-sys',
        summary: [{ type: 'text', text: 'Summary of turns 1 and 2' }],
        shadowedRange: { start: 2, end: 10 },
        shadowedSeqs: [2, 4, 5, 8, 9, 10],
        shadowedTokenCount: 200,
        provider: 'test-p',
        model: 'test-m',
      },
    },
    {
      type: 'user/message', seq: 14, time: 23,
      data: {
        id: 'u-cmp',
        role: 'user',
        content: [{ type: 'text', text: 'This is an automatically generated checkpoint...\n\n<summary>\nSummary of turns 1 and 2\n</summary>' }],
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'cmp-sys' },
      },
      surfaceOp: { op: 'replace', startSeq: 2, endSeq: 10 },
      sourceEventSeqs: [12, 13, 2, 4, 5, 8, 9, 10],
    },
    {
      type: 'compaction/end', seq: 15, time: 24,
      data: { compactionId: 'cmp-sys', turn: 2 },
    },
  ]

  let routeHandler
  let created
  const followups = []
  const sourceSession = {
    id: 'source-edit-sys-cmp',
    header: sourceHeader,
    snapshotEvents: () => sourceEvents,
  }
  const sourceAgent = {
    session: sourceSession,
    options: { provider: 'test-p', model: 'test-m' },
    runMaintenance: async fn => fn(sourceAgent),
  }
  const childSession = {
    id: 'child-edit-sys-cmp',
    header: { id: 'child-edit-sys-cmp', version: 3, createdAt: 30 },
    events: [],
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

  const editPayload = {
    action: 'edit',
    sessionId: 'source-edit-sys-cmp',
    eventSeq: 14,
    blockIndex: 0,
    text: 'Updated summary of turns 1 and 2',
    cascade: 'preserve',
  }

  const req = {
    method: 'POST',
    url: '/message-edit',
    headers: { host: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data') listener(Buffer.from(JSON.stringify(editPayload)))
      if (event === 'end') queueMicrotask(listener)
    },
  }

  let status
  let body
  await routeHandler(req, {
    writeHead: value => { status = value },
    end: value => { body = JSON.parse(value) },
  })

  assert.equal(status, 200, JSON.stringify(body))
  assert.ok(created, 'Child agent should be created')

  // Find the compaction user message in the seed
  const cmpEvent = created.seed.find(e => e.type === 'user/message' && e.data.source?.plugin === 'compact')
  assert.ok(cmpEvent, 'Compaction user message must exist')
  assert.equal(cmpEvent.surfaceOp.op, 'replace')
  assert.equal(cmpEvent.surfaceOp.startSeq, 2)
  assert.equal(cmpEvent.surfaceOp.endSeq, 10)

  // Verify intermediate system messages 5 and 10 are INCLUDED in sourceEventSeqs
  assert.ok(cmpEvent.sourceEventSeqs.includes(5), 'sourceEventSeqs must include intermediate system message at seq 5')
  assert.ok(cmpEvent.sourceEventSeqs.includes(10), 'sourceEventSeqs must include intermediate system message at seq 10')
  // Surface node 0 (system head) must NOT be shadowed
  assert.ok(!cmpEvent.sourceEventSeqs.includes(0), 'System head node 0 must not be shadowed')

  // Verify the entire seed folds cleanly without surface validation errors
  const folded = foldSurface(created.seed)
  assert.deepEqual(folded.nodes, [0, cmpEvent.seq], 'Surface should consist of system head and the replacement compaction node')
})

test('fork with compaction and intermediate system messages satisfies foldSurface', async () => {
  const sourceHeader = { id: 'source-fork-sys-cmp', version: 3, createdAt: 1, cwd: '/tmp' }
  const sourceEvents = [
    {
      type: 'system/message', seq: 0, time: 9,
      data: { turn: 0, step: 0, message: { id: 'sys0', role: 'system', content: [{ type: 'text', text: 'System head' }] } },
      surfaceOp: 'append',
    },
    { type: 'turn/start', seq: 1, time: 10, data: { turn: 1 } },
    {
      type: 'user/message', seq: 2, time: 11,
      data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Prompt 1' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    { type: 'request/header', seq: 3, time: 12, data: { header: { config: { provider: 'test-p', model: 'test-m' } } } },
    {
      type: 'assistant/message', seq: 4, time: 13,
      data: { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Reply 1' }], source: { kind: 'model', provider: 'test-p', model: 'test-m' } } },
      surfaceOp: 'append',
    },
    {
      type: 'system/message', seq: 5, time: 14,
      data: { turn: 1, step: 2, message: { id: 'sys-mid-1', role: 'system', content: [{ type: 'text', text: 'Intermediate system prompt 1' }] } },
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 6, time: 15, data: { turn: 1, reason: { kind: 'completed' } } },
    {
      type: 'compaction/start', seq: 7, time: 21,
      data: { compactionId: 'cmp-sys', turn: 1 },
    },
    {
      type: 'compaction/summary', seq: 8, time: 22,
      data: {
        compactionId: 'cmp-sys',
        summary: [{ type: 'text', text: 'Summary' }],
        shadowedRange: { start: 2, end: 5 },
        shadowedSeqs: [2, 4, 5],
        shadowedTokenCount: 100,
        provider: 'test-p',
        model: 'test-m',
      },
    },
    {
      type: 'user/message', seq: 9, time: 23,
      data: {
        id: 'u-cmp',
        role: 'user',
        content: [{ type: 'text', text: 'This is an automatically generated checkpoint...\n\n<summary>\nSummary\n</summary>' }],
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'cmp-sys' },
      },
      surfaceOp: { op: 'replace', startSeq: 2, endSeq: 5 },
      sourceEventSeqs: [7, 8, 2, 4, 5],
    },
    {
      type: 'compaction/end', seq: 10, time: 24,
      data: { compactionId: 'cmp-sys', turn: 1 },
    },
  ]

  let routeHandler
  let created
  const followups = []
  const sourceSession = {
    id: 'source-fork-sys-cmp',
    header: sourceHeader,
    snapshotEvents: () => sourceEvents,
  }
  const sourceAgent = {
    session: sourceSession,
    options: { provider: 'test-p', model: 'test-m' },
    runMaintenance: async fn => fn(sourceAgent),
  }
  const childSession = {
    id: 'child-fork-sys-cmp',
    header: { id: 'child-fork-sys-cmp', version: 3, createdAt: 30 },
    events: [],
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

  const forkPayload = {
    action: 'fork',
    sessionId: 'source-fork-sys-cmp',
    rows: [
      { kind: 'user', text: 'Prompt 1', sourceEventSeq: 2 },
      { kind: 'assistant.response', text: 'Reply 1', sourceEventSeq: 4 },
      { kind: 'system', text: 'Intermediate system prompt 1', sourceEventSeq: 5 },
      { kind: 'compaction', text: 'Forked summary', compactionId: 'cmp-sys', sourceEventSeq: 9 },
      { kind: 'user', text: 'New prompt after fork' },
    ],
  }

  const req = {
    method: 'POST',
    url: '/message-edit',
    headers: { host: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data') listener(Buffer.from(JSON.stringify(forkPayload)))
      if (event === 'end') queueMicrotask(listener)
    },
  }

  let status
  let body
  await routeHandler(req, {
    writeHead: value => { status = value },
    end: value => { body = JSON.parse(value) },
  })

  assert.equal(status, 200, JSON.stringify(body))
  assert.ok(created, 'Child agent should be created')

  // Find compaction user message in seed
  const cmpEvent = created.seed.find(e => e.type === 'user/message' && e.data.source?.plugin === 'compact')
  assert.ok(cmpEvent, 'Compaction user message must exist')

  // Verify foldSurface succeeds on created.seed
  const folded = foldSurface(created.seed)
  assert.ok(folded.nodes.includes(cmpEvent.seq))
})


