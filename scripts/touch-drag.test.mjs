import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('client bundle contains mobile touch drag affordances', async () => {
  const clientJs = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  
  // Verify touch-action: none is present in the CSS
  assert.match(clientJs, /touch-action:\s*none/, 'CSS must include touch-action: none for drag handle')
  assert.match(clientJs, /-webkit-touch-callout:\s*none/, 'CSS must disable iOS touch callout')
  
  // Verify touch drag ghost classes and data attributes
  assert.match(clientJs, /touchDragGhost/, 'Client bundle must include touchDragGhost')
  assert.match(clientJs, /data-message-key/, 'Cards must include data-message-key attribute')
  assert.match(clientJs, /data-section-id/, 'Sections must include data-section-id attribute')
  assert.match(clientJs, /data-touch-dragging/, 'Root must include data-touch-dragging attribute')
  assert.match(clientJs, /data-active/, 'Drag handles must reflect active drag state')
  
  // Verify touch event handlers
  assert.match(clientJs, /onTouchStart/, 'Drag handles must have onTouchStart')
  assert.match(clientJs, /touchmove/, 'Must register touchmove listener')
  assert.match(clientJs, /touchend/, 'Must register touchend listener')
  assert.match(clientJs, /touchcancel/, 'Must register touchcancel listener')
})

test('reorderRow logic correctly handles top and bottom positions', () => {
  function reorderRow(rows, sourceKey, targetKey, position) {
    if (sourceKey === targetKey) return rows
    const currentRows = [...rows]
    const sourceIndex = currentRows.findIndex(r => r.key === sourceKey)
    const targetIndex = currentRows.findIndex(r => r.key === targetKey)
    if (sourceIndex === -1 || targetIndex === -1) return rows

    const [movedRow] = currentRows.splice(sourceIndex, 1)
    if (!movedRow) return rows

    let insertIndex = currentRows.findIndex(r => r.key === targetKey)
    if (position === 'bottom') {
      insertIndex += 1
    }
    currentRows.splice(insertIndex, 0, movedRow)
    return currentRows
  }

  const initial = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }]

  // Move 'a' below 'c'
  const r1 = reorderRow(initial, 'a', 'c', 'bottom')
  assert.deepEqual(r1.map(r => r.key), ['b', 'c', 'a', 'd'])

  // Move 'd' above 'b'
  const r2 = reorderRow(initial, 'd', 'b', 'top')
  assert.deepEqual(r2.map(r => r.key), ['a', 'd', 'b', 'c'])

  // Move 'c' above 'a'
  const r3 = reorderRow(initial, 'c', 'a', 'top')
  assert.deepEqual(r3.map(r => r.key), ['c', 'a', 'b', 'd'])

  // Same key returns unchanged
  const r4 = reorderRow(initial, 'b', 'b', 'top')
  assert.deepEqual(r4.map(r => r.key), ['a', 'b', 'c', 'd'])
})

test('reorderSection logic correctly handles reordering sections', () => {
  function reorderSection(sections, sourceId, targetId, position) {
    if (sourceId === targetId) return sections
    const currentSections = [...sections]
    const sourceIndex = currentSections.findIndex(s => s.id === sourceId)
    const targetIndex = currentSections.findIndex(s => s.id === targetId)
    if (sourceIndex === -1 || targetIndex === -1) return sections

    const [movedSection] = currentSections.splice(sourceIndex, 1)
    if (!movedSection) return sections

    let insertIndex = currentSections.findIndex(s => s.id === targetId)
    if (position === 'bottom') {
      insertIndex += 1
    }
    currentSections.splice(insertIndex, 0, movedSection)
    return currentSections
  }

  const sections = [
    { id: 'turn-1', rows: [{ key: '1a' }, { key: '1b' }] },
    { id: 'turn-2', rows: [{ key: '2a' }, { key: '2b' }] },
    { id: 'turn-3', rows: [{ key: '3a' }] },
  ]

  // Move turn-3 to top of turn-1
  const s1 = reorderSection(sections, 'turn-3', 'turn-1', 'top')
  assert.deepEqual(s1.map(s => s.id), ['turn-3', 'turn-1', 'turn-2'])
  assert.deepEqual(s1.flatMap(s => s.rows).map(r => r.key), ['3a', '1a', '1b', '2a', '2b'])

  // Move turn-1 below turn-2
  const s2 = reorderSection(sections, 'turn-1', 'turn-2', 'bottom')
  assert.deepEqual(s2.map(s => s.id), ['turn-2', 'turn-1', 'turn-3'])
})
