/**
 * JSON persistence for dsh-membubble.
 *
 * Layout under the data directory:
 *
 *   <dataDir>/<namespace>/persons/<safe person id>.json
 *   <dataDir>/<namespace>/groups/<safe group id>.json
 *   <dataDir>/<namespace>/bindings.json
 *
 * One file per entity keeps a corrupt document local to one person instead of
 * taking down every bubble. A document that fails to parse is copied aside
 * before it can be overwritten. Writes are atomic (temp + rename), and
 * documents are cached in memory because prompt assembly reads them on every
 * model step.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { emptyBindings, normalizeGroup, normalizePerson, promotePerson } from './model.js'
import { safeId } from './util.js'

/** `$DSH_HOME`, else `~/.dsh`. */
export function dshHome() {
  const configured = String(process.env.DSH_HOME ?? '').trim()
  if (configured) return path.resolve(configured)
  return path.join(os.homedir(), '.dsh')
}

/** @param {string} configured @param {string} namespace */
export function resolveDataDir(configured, namespace) {
  const base = String(configured ?? '').trim()
    ? path.resolve(expandHome(String(configured).trim()))
    : path.join(dshHome(), 'membubble')
  return path.join(base, safeId(namespace || 'default'))
}

function expandHome(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

function readJson(file, warn, corruptSeen) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') warn?.(`记忆文件读取失败：${file}（${String(error?.message ?? error)}）`)
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    if (!corruptSeen.has(file)) {
      corruptSeen.add(file)
      const target = `${file}.corrupt-${Date.now()}`
      try {
        fs.copyFileSync(file, target)
        warn?.(`记忆文件损坏，已保留副本 ${target}（${String(error?.message ?? error)}）`)
      } catch (copyError) {
        warn?.(`记忆文件损坏且无法保留副本：${file}（${String(copyError?.message ?? copyError)}）`)
      }
    }
    return undefined
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

export class BubbleStore {
  /**
   * @param {string} dir
   * @param {{ warn?: (message: string) => void }} [options]
   */
  constructor(dir, options = {}) {
    this.dir = dir
    this.warn = options.warn ?? (() => {})
    this.corruptSeen = new Set()
    /** @type {Map<string, Record<string, any>>} */
    this.persons = new Map()
    /** @type {Map<string, Record<string, any>>} */
    this.groups = new Map()
    /** @type {Record<string, any> | null} */
    this.bindings = null
  }

  personFile(id) {
    return path.join(this.dir, 'persons', `${safeId(id)}.json`)
  }

  groupFile(id) {
    return path.join(this.dir, 'groups', `${safeId(id)}.json`)
  }

  bindingsFile() {
    return path.join(this.dir, 'bindings.json')
  }

  personArchiveFile(id) {
    return path.join(this.dir, 'persons', `${safeId(id)}.archive.jsonl`)
  }

  groupArchiveFile(id) {
    return path.join(this.dir, 'groups', `${safeId(id)}.archive.jsonl`)
  }

  /**
   * Append evicted records to an entity's archive. The archive is append-only:
   * trimming the active document never deletes the only copy.
   */
  appendArchive(file, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 0
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const now = Date.now()
    const body = rows.map((row) => JSON.stringify({ archivedAt: now, ...row })).join('\n')
    fs.appendFileSync(file, `${body}\n`, { encoding: 'utf8', mode: 0o600 })
    return rows.length
  }

  /** @param {string} id @param {Array<Record<string, any>>} episodes */
  archivePersonEpisodes(id, episodes) {
    return this.appendArchive(this.personArchiveFile(id), episodes)
  }

  /** @param {string} id @param {Array<Record<string, any>>} events */
  archiveGroupEvents(id, events) {
    return this.appendArchive(this.groupArchiveFile(id), events)
  }

  /** @param {string} id @param {number} [limit] */
  readPersonArchive(id, limit = 2000) {
    return this.readArchive(this.personArchiveFile(id), limit)
  }

  /** @param {string} id @param {number} [limit] */
  readGroupArchive(id, limit = 200) {
    return this.readArchive(this.groupArchiveFile(id), limit)
  }

  readArchive(file, limit) {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return []
    }
    const lines = text.split('\n').filter(Boolean)
    const rows = []
    for (const line of lines.slice(-Math.max(1, limit))) {
      try {
        const value = JSON.parse(line)
        if (value && typeof value === 'object') rows.push(value)
      } catch {
        // A single truncated line must not hide the rest of the archive.
      }
    }
    return rows
  }

  /** @param {string} file */
  countArchive(file) {
    try {
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length
    } catch {
      return 0
    }
  }

  countPersonArchive(id) {
    return this.countArchive(this.personArchiveFile(id))
  }

  countGroupArchive(id) {
    return this.countArchive(this.groupArchiveFile(id))
  }

  /** @param {string} id @returns {Record<string, any> | null} */
  readPerson(id) {
    const key = String(id)
    if (this.persons.has(key)) return this.persons.get(key)
    const raw = readJson(this.personFile(key), this.warn, this.corruptSeen)
    if (raw === undefined) return null
    const person = normalizePerson(raw, key, String(raw?.name ?? ''), Date.now())
    this.persons.set(key, person)
    return person
  }

  /** @param {Record<string, any>} person */
  writePerson(person) {
    this.persons.set(String(person.id), person)
    writeJsonAtomic(this.personFile(person.id), person)
  }

  /** @param {string} id @param {string} name @param {number} at */
  ensurePerson(id, name, at, options = {}) {
    const existing = this.readPerson(id)
    if (existing) {
      let changed = false
      if (name && existing.name !== name) {
        existing.name = String(name).trim() || existing.name
        existing.updatedAt = at
        changed = true
      }
      // A person met in private chat is already known; opening their L1 should
      // not leave them gated in a group they share later.
      if (options.promoted === true && !existing.promoted) {
        changed = promotePerson(existing, at) || changed
      }
      if (changed) this.writePerson(existing)
      return existing
    }
    const person = normalizePerson(
      { id, name, promoted: options.promoted === true },
      id,
      name,
      at,
    )
    if (options.promoted === true) {
      person.promoted = true
      person.promotedAt = at
    }
    this.writePerson(person)
    return person
  }

  /** @param {string} id @returns {Record<string, any> | null} */
  readGroup(id) {
    const key = String(id)
    if (this.groups.has(key)) return this.groups.get(key)
    const raw = readJson(this.groupFile(key), this.warn, this.corruptSeen)
    if (raw === undefined) return null
    const group = normalizeGroup(raw, key, String(raw?.name ?? ''), Date.now())
    this.groups.set(key, group)
    return group
  }

  /** @param {Record<string, any>} group */
  writeGroup(group) {
    this.groups.set(String(group.id), group)
    writeJsonAtomic(this.groupFile(group.id), group)
  }

  /** @param {string} id @param {string} name @param {number} at */
  ensureGroup(id, name, at) {
    const existing = this.readGroup(id)
    if (existing) {
      if (name && existing.name !== name) {
        existing.name = String(name).trim() || existing.name
        existing.updatedAt = at
        this.writeGroup(existing)
      }
      return existing
    }
    const group = normalizeGroup({ id, name }, id, name, at)
    this.writeGroup(group)
    return group
  }

  /** @returns {Record<string, any>} */
  readBindings() {
    if (this.bindings) return this.bindings
    const raw = readJson(this.bindingsFile(), this.warn, this.corruptSeen)
    const bindings = raw && typeof raw === 'object' ? raw : emptyBindings()
    if (!bindings.sessions || typeof bindings.sessions !== 'object') bindings.sessions = {}
    this.bindings = bindings
    return bindings
  }

  /** @param {Record<string, any>} bindings */
  writeBindings(bindings) {
    this.bindings = bindings
    writeJsonAtomic(this.bindingsFile(), bindings)
  }

  /** @returns {Array<Record<string, any>>} */
  listPersons() {
    const dir = path.join(this.dir, 'persons')
    let names = []
    try {
      names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
    } catch {
      return []
    }
    const out = []
    for (const name of names) {
      const raw = readJson(path.join(dir, name), this.warn, this.corruptSeen)
      if (!raw) continue
      out.push(normalizePerson(raw, String(raw.id ?? ''), String(raw.name ?? ''), Date.now()))
    }
    return out
  }

  /** @returns {Array<Record<string, any>>} */
  listGroups() {
    const dir = path.join(this.dir, 'groups')
    let names = []
    try {
      names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
    } catch {
      return []
    }
    const out = []
    for (const name of names) {
      const raw = readJson(path.join(dir, name), this.warn, this.corruptSeen)
      if (!raw) continue
      out.push(normalizeGroup(raw, String(raw.id ?? ''), String(raw.name ?? ''), Date.now()))
    }
    return out
  }

  /** Drop in-memory documents so the next read hits disk (tests / external edits). */
  invalidate() {
    this.persons.clear()
    this.groups.clear()
    this.bindings = null
  }
}
