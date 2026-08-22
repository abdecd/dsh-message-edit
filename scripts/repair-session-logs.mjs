#!/usr/bin/env node
/**
 * Maintenance: mark `message-edit/version` session events that were written
 * before the plugin adopted the SessionEvent.ignorable envelope contract.
 *
 * The core persistence read path refuses a log containing an event type it
 * does not know unless the event carries `ignorable: true`
 * (`dsh-session-persistence` -> `assertEventsSupported`). Logs written by
 * older plugin builds therefore fail to load on any harness. This repair
 * inserts `,"ignorable":true` into the envelope of each unmarked
 * `message-edit/version` event and rewrites the stored log; nothing else
 * changes byte-wise, and the event semantics are untouched (the marker only
 * authorizes readers that do not know the type to skip the record).
 *
 * Usage:
 *   node scripts/repair-session-logs.mjs              # dry run, ~/.dsh/sessions
 *   node scripts/repair-session-logs.mjs --apply      # write (backs up originals)
 *   node scripts/repair-session-logs.mjs --root DIR   # scan a different root
 *
 * Logs are matched as <root>/<project>/<session>/session.jsonl[.zstd].
 * Before replacing a file, its original is copied to a backup directory and
 * the replacement is verified to differ from the original ONLY by the
 * inserted marker(s).
 */
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

/* Stored logs are concatenated zstd frames (the persistence backend appends one
   checksummed frame per durable batch). Node's one-shot API decodes a single
   frame, so frame boundaries are located structurally first. */
const ZSTD_MAGIC = 4247762216

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid zstd frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

const TARGET_TYPE = 'message-edit/version'
const MARKER = ',"ignorable":true}'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const rootFlag = argv.indexOf('--root')
const root = rootFlag !== -1 ? argv[rootFlag + 1] : join(homedir(), '.dsh', 'sessions')
const backupDir = apply ? join(tmpdir(), `dsh-message-edit-repair-${Date.now()}`) : undefined

/** Yield each top-level JSON object span `{...}` on one line as [text, start, end]. */
function* lineSpans(line) {
  let i = 0
  while (i < line.length) {
    while (i < line.length && (line[i] === ' ' || line[i] === '\t' || line[i] === '\r')) i += 1
    if (i >= line.length) return
    if (line[i] !== '{') throw new Error(`line does not start with a JSON object at column ${i}`)
    const start = i
    let depth = 0
    let inString = false
    let escaped = false
    for (; i < line.length; i += 1) {
      const c = line[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
      } else if (c === '"') inString = true
      else if (c === '{') depth += 1
      else if (c === '}') {
        depth -= 1
        if (depth === 0) {
          i += 1
          break
        }
      }
    }
    if (depth !== 0 || inString) throw new Error('unbalanced JSON object span')
    const text = line.slice(start, i)
    yield [text, start, i]
  }
}

/** Rewrite one line, marking every unmarked target event; returns [line, count]. */
function repairLine(line) {
  let count = 0
  let out = ''
  let cursor = 0
  for (const [spanText, start, end] of lineSpans(line)) {
    let doc
    try {
      doc = JSON.parse(spanText)
    } catch {
      throw new Error(`stored log line is not valid JSON: ${line.slice(0, 80)}...`)
    }
    let span = spanText
    if (doc?.type === TARGET_TYPE && doc.ignorable !== true) {
      span = spanText.slice(0, -1) + MARKER
      count += 1
    }
    out += line.slice(cursor, start) + span
    cursor = end
  }
  out += line.slice(cursor)
  return [out, count]
}

/** Decode a stored log; returns the plaintext plus any structurally incomplete final frame. */
function decodeLog(filePath, bytes) {
  if (!filePath.endsWith('.zstd')) return { text: bytes.toString('utf8'), tornTail: undefined }
  const { frames, tornStart } = scanZstdFrames(bytes)
  const parts = frames.map(({ start, end }) => zstdDecompressSync(bytes.subarray(start, end)))
  return {
    text: Buffer.concat(parts).toString('utf8'),
    tornTail: tornStart === undefined ? undefined : bytes.subarray(tornStart),
  }
}

/** Re-encode as one checksummed frame, preserving a torn final frame byte-for-byte. */
function encodeLog(filePath, text, tornTail) {
  if (!filePath.endsWith('.zstd')) return Buffer.from(text, 'utf8')
  const frame = zstdCompressSync(Buffer.from(text, 'utf8'), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  })
  return tornTail === undefined ? frame : Buffer.concat([frame, tornTail])
}

function listLogFiles(rootDir) {
  const files = []
  for (const project of readdirSync(rootDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const projectDir = join(rootDir, project.name)
    for (const session of readdirSync(projectDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const sessionDir = join(projectDir, session.name)
      for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
        const path = join(sessionDir, name)
        try {
          readFileSync(path)
          files.push(path)
        } catch {
          // absent variant
        }
      }
    }
  }
  return files
}

let filesScanned = 0
let filesChanged = 0
let eventsMarked = 0
let skippedLive = 0
const failures = []

for (const file of listLogFiles(root)) {
  filesScanned += 1
  try {
    const originalBytes = readFileSync(file)
    const { text, tornTail } = decodeLog(file, originalBytes)
    const lines = text.split('\n')
    const repairedLines = []
    let marked = 0
    for (let i = 0; i < lines.length; i += 1) {
      const [repairedLine, count] = repairLine(lines[i])
      if (count > 0 && repairedLine.replaceAll(MARKER, '}') !== lines[i]) {
        throw new Error(`line ${i + 1}: verification failed, only the marker may change`)
      }
      repairedLines.push(repairedLine)
      marked += count
    }
    if (marked === 0) continue
    const newText = repairedLines.join('\n')
    if (apply) {
      // The persistence backend re-resolves the path on every append, so a
      // rename is safe for future writes — but a log that is actively
      // appended to would lose its in-flight batch to the orphaned inode.
      // Skip any file that changed since the scan; rerun the repair later.
      if (Buffer.compare(readFileSync(file), originalBytes) !== 0) {
        skippedLive += 1
        console.warn(`skipped ${file}: file changed while repairing (live session?) — rerun later`)
        continue
      }
      mkdirSync(backupDir, { recursive: true })
      copyFileSync(file, join(backupDir, `${filesScanned}-${file.replaceAll('/', '_')}`))
      const tempPath = `${file}.repair-${randomUUID()}`
      writeFileSync(tempPath, encodeLog(file, newText, tornTail))
      // Verify the round-tripped bytes before the replacement becomes visible.
      const roundTrip = decodeLog(file, readFileSync(tempPath))
      if (roundTrip.text !== newText || Buffer.compare(roundTrip.tornTail ?? Buffer.alloc(0), tornTail ?? Buffer.alloc(0)) !== 0) {
        renameSync(tempPath, `${tempPath}.orphan`)
        throw new Error('post-write verification failed; original untouched, orphan kept next to it')
      }
      if (Buffer.compare(readFileSync(file), originalBytes) !== 0) {
        renameSync(tempPath, `${tempPath}.orphan`)
        skippedLive += 1
        console.warn(`skipped ${file}: file changed at the last moment (live session?) — rerun later`)
        continue
      }
      renameSync(tempPath, file)
    }
    filesChanged += 1
    eventsMarked += marked
    console.log(`${apply ? 'repaired' : 'would repair'} ${file} (+${marked} marker${marked === 1 ? '' : 's'})`)
  } catch (error) {
    failures.push({ file, error: String(error?.message ?? error) })
    console.error(`FAILED ${file}: ${String(error?.message ?? error)}`)
  }
}

console.log(`\nscanned ${filesScanned} log(s) under ${root}`)
console.log(`${apply ? 'repaired' : 'would repair'} ${filesChanged} file(s), ${eventsMarked} event(s) of type ${TARGET_TYPE}`)
if (skippedLive > 0) console.log(`${skippedLive} file(s) skipped (changed while repairing — likely live sessions; rerun later)`)
if (backupDir !== undefined) console.log(`originals backed up to ${backupDir}`)
if (!apply) console.log('dry run only — rerun with --apply to write')
if (failures.length > 0) {
  console.error(`${failures.length} file(s) failed; nothing was left half-written`)
  process.exitCode = 1
}
