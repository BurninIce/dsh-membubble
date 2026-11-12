/**
 * Bounded conversation focus for a group.
 *
 * A large group must not turn every speaker into a person-memory pipeline. This
 * board keeps the last `focusWindow` non-noise messages within `focusTtlSec`,
 * scores speakers by weighted importance plus a small turn bonus, and returns:
 *
 *   active  — top N; run the person pipeline and inject their card
 *   buffer  — next M; contribute to the group atmosphere only
 *   ''      — outside the board; group atmosphere only
 *
 * The board is persisted inside the group document (`group.focus`), capped in
 * both entries and age, so it stays a constant-size input regardless of how
 * many people have ever spoken.
 */

import { clamp, oneLine, truncate } from './util.js'

export const FOCUS_DEFAULTS = {
  window: 60,
  ttlSec: 6 * 3600,
  active: 5,
  buffer: 5,
  turnWeight: 0.5,
  importantMult: 5,
  directImportance: 3,
  memberTtlSec: 30 * 24 * 3600,
  maxGroupMembersStored: 200,
}

function option(config, key) {
  const value = Number(config?.[key])
  return Number.isFinite(value) ? value : FOCUS_DEFAULTS[key]
}

/** Trim the board by age and entry count, in place. */
export function trimFocus(group, config, now = Date.now()) {
  const ttlSec = option(config, 'focusTtlSec')
  const windowSize = option(config, 'focusWindow')
  group.focus = (Array.isArray(group.focus) ? group.focus : [])
    .filter((entry) => entry && entry.uid && Number(entry.at) >= now - ttlSec * 1000)
    .slice(-windowSize)
  return group.focus
}

function weightedImportance(importance, config) {
  const mult = option(config, 'focusImportantMult')
  return importance >= 2 ? importance * mult : 1
}

/** Aggregate the board by speaker, best first. Deterministic on ties. */
export function rankedFocus(group, config, now = Date.now()) {
  trimFocus(group, config, now)
  const aggregate = new Map()
  for (const entry of group.focus) {
    const uid = String(entry.uid)
    const current = aggregate.get(uid) ?? {
      uid,
      name: '',
      turns: 0,
      importance: 0,
      weighted: 0,
      lastAt: 0,
    }
    const importance = clamp(entry.imp ?? 1, 1, 3)
    current.turns += 1
    current.importance += importance
    current.weighted += weightedImportance(importance, config)
    if (entry.name) current.name = truncate(oneLine(entry.name), 40)
    current.lastAt = Math.max(current.lastAt, Number(entry.at) || 0)
    aggregate.set(uid, current)
  }
  const turnWeight = option(config, 'focusTurnWeight')
  const rows = [...aggregate.values()].map((row) => ({
    ...row,
    score: Math.round((row.weighted + turnWeight * row.turns) * 100) / 100,
  }))
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      (a.name || a.uid).localeCompare(b.name || b.uid, 'zh', { sensitivity: 'base' }) ||
      a.uid.localeCompare(b.uid),
  )
  return rows
}

/** Current active and buffer lists for one group. */
export function focusRoles(group, config, now = Date.now()) {
  const rows = rankedFocus(group, config, now)
  const activeCount = option(config, 'focusActive')
  const bufferCount = option(config, 'focusBuffer')
  const active = rows.slice(0, activeCount).map(toRole)
  const buffer = rows.slice(activeCount, activeCount + bufferCount).map(toRole)
  return { active, buffer }
}

function toRole(row) {
  return {
    uid: row.uid,
    name: row.name,
    score: row.score,
    turns: row.turns,
    importance: row.importance,
  }
}

/** Role of one speaker: 'active', 'buffer', or ''. */
export function focusRole(group, uid, config, now = Date.now()) {
  const id = String(uid ?? '')
  if (!id) return ''
  const roles = focusRoles(group, config, now)
  if (roles.active.some((member) => member.uid === id)) return 'active'
  if (roles.buffer.some((member) => member.uid === id)) return 'buffer'
  return ''
}

/**
 * Record one non-noise group message and return the speaker's new role.
 * @returns {'active'|'buffer'|''}
 */
export function recordFocus(group, entry, config, now = Date.now()) {
  const uid = String(entry?.uid ?? '').trim()
  if (!uid) return ''
  group.focus ??= []
  group.focus.push({
    uid,
    name: truncate(oneLine(entry.name), 40),
    imp: clamp(entry.importance ?? 1, 1, 3),
    at: entry.at ?? now,
  })
  trimFocus(group, config, now)
  return focusRole(group, uid, config, now)
}

/**
 * Backfill the last `rounds` entries of a speaker with the episode importance.
 * Keeps direct/important interactions from being diluted by later noise.
 */
export function noteFocusImportance(group, uid, importance, config, now = Date.now(), rounds = 1) {
  const id = String(uid ?? '')
  const value = clamp(importance, 1, 3)
  if (!id || !value) return false
  let left = Math.max(1, Number(rounds) || 1)
  let hit = false
  for (let i = (group.focus?.length ?? 0) - 1; i >= 0 && left > 0; i -= 1) {
    const entry = group.focus[i]
    if (String(entry.uid) !== id) continue
    entry.imp = value
    left -= 1
    hit = true
  }
  if (hit) trimFocus(group, config, now)
  return hit
}

/** True when the message addresses the agent directly (or the transport says so). */
export function isDirect(text, agentName, explicit = false) {
  if (explicit === true) return true
  const value = String(text ?? '')
  if (/@[^\s@，。！？,.!?]{1,16}/u.test(value)) return true
  const name = String(agentName ?? '').trim()
  if (!name) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(^|[\\s，。！？,.!?@])${escaped}($|[\\s，。！？,.!?])`, 'u').test(value)
}

/** Drop non-promoted members that have been quiet and are no longer focused. */
export function pruneMembers(group, config, now = Date.now()) {
  trimFocus(group, config, now)
  const ttlSec = option(config, 'memberTtlSec')
  const cap = option(config, 'maxGroupMembersStored')
  const focused = new Set([...(group.focus ?? []).map((entry) => String(entry.uid))])
  const rows = Object.entries(group.members ?? {}).map(([uid, member]) => ({ uid, ...member }))
  const keep = rows.filter(
    (member) => member.promoted || focused.has(member.uid) || now - (member.lastSeen || 0) < ttlSec * 1000,
  )
  // Promoted members are never dropped by the storage cap; the cap applies to
  // the unpromoted remainder. A group with more promoted members than the cap
  // stays correct at the cost of a larger member map.
  const promoted = keep.filter((member) => member.promoted)
  const rest = keep.filter((member) => !member.promoted)
  const room = Math.max(0, cap - promoted.length)
  rest.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
  const kept = [...promoted, ...rest.slice(0, room)]
  const next = {}
  for (const member of kept) {
    next[member.uid] = {
      name: member.name,
      style: member.style,
      lastSeen: member.lastSeen,
      promoted: member.promoted,
    }
  }
  group.members = next
  return rows.length - kept.length
}
