/**
 * The bubble data model.
 *
 * Three documents, deliberately separate:
 * - person bubble (L1): one person's episodes plus the inducted card;
 * - group bubble (L0): a group's impersonal atmosphere/events and member styles;
 * - bindings: which DSH session speaks as which person/group.
 *
 * Invariants enforced here, not in prompts:
 * - facts and impressions live only on the person they belong to;
 * - the group bubble never stores what somebody said — names are stripped from
 *   its free text, and member styles may only arrive from that member's own
 *   induction (never from a group-summary call);
 * - numeric stats move by at most a bounded step per induction, and the
 *   relationship tier is derived from the stats rather than chosen by a model.
 */

import { clamp, oneLine, stringList, truncate } from './util.js'

export const SCHEMA_VERSION = 1
export const RELATIONSHIPS = ['陌生', '相识', '熟络', '亲密', '倾心']
export const MAX_EPISODES = 400
export const MAX_PENDING = 16
export const MAX_CARD_ITEMS = 6
export const MAX_ITEM_CHARS = 48
export const MAX_TAGS = 4
export const MAX_GROUP_EVENTS = 20
export const MAX_GROUP_BUFFER = 60
export const MAX_FOCUS_WINDOW = 60
export const MAX_INDUCTIONS = 20
export const AFFECTION_STEP = 8
export const TRUST_STEP = 8
export const FAMILIARITY_STEP = 6

/** Tier derived from a weighted score; a model never picks the tier directly. */
export function relationshipFor(stats) {
  const affection = clamp(stats?.affection ?? 30, 0, 100)
  const trust = clamp(stats?.trust ?? 30, 0, 100)
  const familiarity = clamp(stats?.familiarity ?? 0, 0, 100)
  const score = affection * 0.4 + trust * 0.4 + familiarity * 0.2
  if (score < 10) return '陌生'
  if (score < 40) return '相识'
  if (score < 60) return '熟络'
  if (score < 80) return '亲密'
  return '倾心'
}

/** @param {string} id @param {string} name @param {number} at */
export function emptyPerson(id, name, at, options = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(id),
    name: oneLine(name) || '对方',
    createdAt: at,
    updatedAt: at,
    promoted: options.promoted === true,
    promotedAt: options.promoted === true ? at : 0,
    interactionCount: 0,
    stats: { affection: 30, trust: 30, familiarity: 0 },
    relationship: '相识',
    style: '',
    card: { impressions: [], facts: [], selfDisclosure: [], reflections: [] },
    episodes: [],
    pending: [],
    lastInductionEpisode: 0,
    lastInductionAt: 0,
    lastInductionCount: 0,
    inductions: [],
  }
}

/** @param {string} id @param {string} name @param {number} at */
export function emptyGroup(id, name, at) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(id),
    name: oneLine(name) || '群聊',
    createdAt: at,
    updatedAt: at,
    vibe: '',
    scene: '',
    events: [],
    members: {},
    buffer: [],
    focus: [],
    lastGroupUpdateAt: 0,
    lastGroupAttemptAt: 0,
    messagesSinceUpdate: 0,
  }
}

export function emptyBindings() {
  return { schemaVersion: SCHEMA_VERSION, sessions: {} }
}

/** Coerce a stored person document into the live shape (forward-tolerant). */
export function normalizePerson(raw, fallbackId = '', fallbackName = '', at = Date.now()) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const person = emptyPerson(source.id ?? fallbackId, source.name ?? fallbackName, at, {
    promoted: source.promoted === true,
  })
  person.createdAt = Number(source.createdAt) || at
  person.updatedAt = Number(source.updatedAt) || at
  person.promotedAt = Number(source.promotedAt) || 0
  person.interactionCount = Math.max(0, Number(source.interactionCount) || 0)
  const stats = source.stats && typeof source.stats === 'object' ? source.stats : {}
  person.stats = {
    affection: clamp(stats.affection ?? 30, 0, 100),
    trust: clamp(stats.trust ?? 30, 0, 100),
    familiarity: clamp(stats.familiarity ?? 0, 0, 100),
  }
  person.relationship = relationshipFor(person.stats)
  person.style = truncate(source.style, 60)
  const card = source.card && typeof source.card === 'object' ? source.card : {}
  for (const key of ['impressions', 'facts', 'selfDisclosure', 'reflections']) {
    person.card[key] = normalizeItems(card[key], at)
  }
  person.episodes = Array.isArray(source.episodes)
    ? source.episodes.map((ep) => normalizeEpisode(ep, at)).filter(Boolean)
    : []
  person.pending = Array.isArray(source.pending)
    ? source.pending.map(normalizeRound).filter(Boolean).slice(-MAX_PENDING)
    : []
  person.lastInductionEpisode = Number(source.lastInductionEpisode) || 0
  person.lastInductionAt = Number(source.lastInductionAt) || 0
  person.lastInductionCount = Number(source.lastInductionCount) || 0
  person.inductions = Array.isArray(source.inductions)
    ? source.inductions.filter((row) => row && typeof row === 'object').slice(-MAX_INDUCTIONS)
    : []
  return person
}

/** Coerce a stored group document into the live shape. */
export function normalizeGroup(raw, fallbackId = '', fallbackName = '', at = Date.now()) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const group = emptyGroup(source.id ?? fallbackId, source.name ?? fallbackName, at)
  group.createdAt = Number(source.createdAt) || at
  group.updatedAt = Number(source.updatedAt) || at
  group.vibe = truncate(source.vibe, 120)
  group.scene = truncate(source.scene, 120)
  group.events = Array.isArray(source.events)
    ? source.events
        .filter((row) => row && typeof row === 'object')
        .map((row, index) => ({
          id: Number(row.id) || index + 1,
          at: Number(row.at) || at,
          summary: truncate(row.summary, 80),
          importance: clamp(row.importance ?? 1, 1, 3),
        }))
        .filter((row) => row.summary)
    : []
  group.members = {}
  if (source.members && typeof source.members === 'object') {
    for (const [uid, member] of Object.entries(source.members)) {
      if (!member || typeof member !== 'object') continue
      group.members[uid] = {
        name: truncate(member.name, 40) || uid,
        style: truncate(member.style, 60),
        lastSeen: Number(member.lastSeen) || 0,
        promoted: member.promoted === true,
      }
    }
  }
  group.buffer = Array.isArray(source.buffer)
    ? source.buffer
        .filter((row) => row && typeof row === 'object')
        .map((row) => ({ at: Number(row.at) || at, text: truncate(row.text, 400) }))
        .filter((row) => row.text)
        .slice(-MAX_GROUP_BUFFER)
    : []
  group.focus = Array.isArray(source.focus)
    ? source.focus
        .filter((row) => row && typeof row === 'object' && row.uid)
        .map((row) => ({
          uid: String(row.uid),
          name: truncate(row.name, 40),
          imp: clamp(row.imp ?? 1, 1, 3),
          at: Number(row.at) || at,
        }))
        .slice(-MAX_FOCUS_WINDOW)
    : []
  group.lastGroupUpdateAt = Number(source.lastGroupUpdateAt) || 0
  group.lastGroupAttemptAt = Number(source.lastGroupAttemptAt) || 0
  group.messagesSinceUpdate = Math.max(
    0,
    Number(source.messagesSinceUpdate ?? source.episodesSinceUpdate) || 0,
  )
  return group
}

function normalizeItems(raw, at) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return { text: truncate(item, MAX_ITEM_CHARS), at, sourceIds: [] }
      if (!item || typeof item !== 'object') return null
      const text = truncate(item.text, MAX_ITEM_CHARS)
      if (!text) return null
      return {
        text,
        at: Number(item.at) || at,
        sourceIds: Array.isArray(item.sourceIds) ? item.sourceIds.map(Number).filter(Number.isFinite) : [],
      }
    })
    .filter(Boolean)
    .slice(-MAX_CARD_ITEMS)
}

function normalizeEpisode(raw, at) {
  if (!raw || typeof raw !== 'object') return null
  const summary = truncate(oneLine(raw.summary), 80)
  if (!summary) return null
  return {
    id: Number(raw.id) || 0,
    at: Number(raw.at) || at,
    summary,
    scene: truncate(raw.scene, 40),
    emotion: truncate(raw.emotion, 40),
    importance: clamp(raw.importance ?? 1, 1, 3),
    tags: stringList(raw.tags).slice(0, MAX_TAGS).map((tag) => truncate(tag, 20)),
    userText: truncate(raw.userText, 600),
    assistantText: truncate(raw.assistantText, 600),
    source: raw.source === 'manual' ? 'manual' : 'judge',
  }
}

function normalizeRound(raw) {
  if (!raw || typeof raw !== 'object') return null
  const user = truncate(raw.user, 600)
  const assistant = truncate(raw.assistant, 600)
  if (!user) return null
  return { at: Number(raw.at) || Date.now(), user, assistant }
}

/** Next episode id for one person. */
export function nextEpisodeId(person) {
  return person.episodes.reduce((max, ep) => Math.max(max, ep.id), 0) + 1
}

/**
 * Append one closed episode. The caller trims and archives the overflow.
 * @returns {Record<string, any>} the stored episode
 */
export function addEpisode(person, episode, at) {
  const normalized = normalizeEpisode(
    {
      ...episode,
      id: episode.id ?? nextEpisodeId(person),
      at: episode.at ?? at,
      source: episode.source ?? 'judge',
    },
    at,
  )
  person.episodes.push(normalized)
  person.updatedAt = at
  return normalized
}

/**
 * Keep the active episode list bounded without silently losing history.
 * Low-importance episodes are evicted first; if every episode is important, the
 * oldest important one goes. The caller appends the returned overflow to the
 * person's archive.
 *
 * @returns {Array<Record<string, any>>} evicted episodes, oldest first
 */
export function trimEpisodes(person, max = MAX_EPISODES) {
  const removed = []
  while (person.episodes.length > max) {
    let index = person.episodes.findIndex((episode) => (episode.importance ?? 1) <= 1)
    if (index < 0) index = 0
    removed.push(person.episodes.splice(index, 1)[0])
  }
  return removed
}

/**
 * Drop low-importance episodes past the retention window.
 * @returns {{ count: number, removed: Array<Record<string, any>> }}
 */
export function forgetOld(person, { days, now }) {
  const cutoff = now - days * 86_400_000
  const removed = person.episodes.filter((episode) => (episode.importance ?? 1) <= 1 && episode.at < cutoff)
  if (removed.length) {
    const removedIds = new Set(removed.map((episode) => episode.id))
    person.episodes = person.episodes.filter((episode) => !removedIds.has(episode.id))
  }
  person.updatedAt = now
  return { count: removed.length, removed }
}

/** Append one raw round to the topic buffer, capped. */
export function addPending(person, round) {
  person.pending.push(normalizeRound(round))
  if (person.pending.length > MAX_PENDING) person.pending = person.pending.slice(-MAX_PENDING)
}

/**
 * Apply one induction result.
 *
 * The model proposes absolute values and complete item lists; this function
 * bounds how far stats may travel and validates every item. Missing list fields
 * keep the previous list (a truncated model response must not erase memory).
 *
 * @returns {{ record: Record<string, any>, changed: boolean }}
 */
export function applyInduction(person, result, options = {}) {
  const at = options.at ?? Date.now()
  const before = { ...person.stats }
  const value = result && typeof result === 'object' ? result : {}
  person.stats = {
    affection: stepValue(before.affection, value.affection, AFFECTION_STEP),
    trust: stepValue(before.trust, value.trust, TRUST_STEP),
    familiarity: stepValue(before.familiarity, value.familiarity, FAMILIARITY_STEP, 0),
  }
  person.relationship = relationshipFor(person.stats)
  if (typeof value.style === 'string' && value.style.trim()) {
    person.style = truncate(oneLine(value.style), 60)
  }
  for (const [field, key] of [
    ['impressions', 'impressions'],
    ['facts', 'facts'],
    ['selfDisclosure', 'selfDisclosure'],
    ['reflections', 'reflections'],
  ]) {
    const incoming = value[key]
    if (!Array.isArray(incoming)) continue
    // The prompt asks for the COMPLETE updated list, so a present array is
    // authoritative: this is what lets a model retire an outdated item.
    const items = incoming
      .map((item) => truncate(typeof item === 'string' ? item : item?.text, MAX_ITEM_CHARS))
      .filter(Boolean)
      .slice(0, MAX_CARD_ITEMS)
      .map((text) => ({ text, at, sourceIds: [] }))
    if (items.length) person.card[field] = items
  }
  const episodeIds = Array.isArray(options.episodeIds) ? options.episodeIds : []
  const record = { at, episodeIds, before, after: { ...person.stats } }
  person.inductions.push(record)
  if (person.inductions.length > MAX_INDUCTIONS) person.inductions = person.inductions.slice(-MAX_INDUCTIONS)
  person.lastInductionAt = at
  person.lastInductionCount = person.interactionCount
  person.lastInductionEpisode = Math.max(person.lastInductionEpisode, ...episodeIds, 0)
  person.updatedAt = at
  const changed =
    before.affection !== person.stats.affection ||
    before.trust !== person.stats.trust ||
    before.familiarity !== person.stats.familiarity
  return { record, changed }
}

function stepValue(current, proposed, limit, floor = 0) {
  if (proposed === undefined || proposed === null || proposed === '') return clamp(current, 0, 100)
  const target = clamp(proposed, 0, 100)
  const delta = clamp(target - current, -limit, limit)
  return clamp(Math.round((current + delta) * 10) / 10, floor, 100)
}

/** Mark a person promoted; idempotent. */
export function promotePerson(person, at = Date.now()) {
  if (person.promoted) return false
  person.promoted = true
  person.promotedAt = at
  person.updatedAt = at
  return true
}

/** Record/refresh one group member. Styles are only ever passed from that member's card. */
export function touchMember(group, member, at = Date.now()) {
  const id = String(member.id ?? '').trim()
  if (!id) return null
  const existing = group.members[id] ?? { name: id, style: '', lastSeen: 0, promoted: false }
  const next = {
    name: truncate(member.name, 40) || existing.name,
    style: member.style === undefined ? existing.style : truncate(member.style, 60),
    lastSeen: at,
    promoted: member.promoted === undefined ? existing.promoted : member.promoted === true,
  }
  group.members[id] = next
  group.updatedAt = at
  return next
}

/**
 * Strip member names from group-bubble prose.
 *
 * The group bubble is forbidden from attributing speech or facts to a person.
 * A model told not to use names still sometimes does; replacing every known
 * member name with 「有人」 makes the rule mechanical instead of aspirational.
 */
export function sanitizeGroupText(text, memberNames) {
  let value = oneLine(text)
  const names = stringList(memberNames)
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length)
  for (const name of names) {
    value = value.split(name).join('有人')
  }
  return value
}

/**
 * Apply a group-bubble summarization.
 *
 * Only `vibe`, `scene` and impersonal `events` are accepted. Member styles are
 * intentionally not read from this result.
 */
export function applyGroupUpdate(group, result, options = {}) {
  const at = options.at ?? Date.now()
  const memberNames = options.memberNames ?? Object.values(group.members).map((m) => m.name)
  const value = result && typeof result === 'object' ? result : {}
  const vibe = sanitizeGroupText(value.vibe, memberNames)
  const scene = sanitizeGroupText(value.scene, memberNames)
  if (vibe) group.vibe = truncate(vibe, 120)
  if (scene) group.scene = truncate(scene, 120)
  const events = Array.isArray(value.events) ? value.events : []
  let nextId = group.events.reduce((max, row) => Math.max(max, row.id), 0) + 1
  let added = 0
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue
    const summary = truncate(sanitizeGroupText(raw.summary, memberNames), 80)
    if (!summary) continue
    group.events.push({ id: nextId, at, summary, importance: clamp(raw.importance ?? 1, 1, 3) })
    nextId += 1
    added += 1
  }
  const overflow = trimGroupEvents(group)
  const accepted = Boolean(vibe || scene || added)
  if (accepted) {
    group.lastGroupUpdateAt = at
    group.messagesSinceUpdate = 0
    group.buffer = []
    group.updatedAt = at
  }
  return { accepted, vibe: group.vibe, scene: group.scene, added, overflow }
}

/** Keep the active group event list bounded; caller archives the overflow. */
export function trimGroupEvents(group, max = MAX_GROUP_EVENTS) {
  const removed = []
  while (group.events.length > max) {
    let index = group.events.findIndex((event) => (event.importance ?? 1) <= 1)
    if (index < 0) index = 0
    removed.push(group.events.splice(index, 1)[0])
  }
  return removed
}

/**
 * Append one compact digest line to the group buffer.
 * @returns {Array<{ at: number, text: string }>} lines dropped because the buffer was full
 */
export function addGroupBuffer(group, text, at) {
  const value = truncate(oneLine(text), 400)
  if (!value) return []
  group.buffer.push({ at, text: value })
  let dropped = []
  if (group.buffer.length > MAX_GROUP_BUFFER) {
    dropped = group.buffer.slice(0, group.buffer.length - MAX_GROUP_BUFFER)
    group.buffer = group.buffer.slice(-MAX_GROUP_BUFFER)
  }
  group.updatedAt = at
  return dropped
}

/** Short text cards for prompts (current inducted state, not raw episodes). */
export function cardDigest(person) {
  const card = person?.card ?? {}
  const section = (label, items) =>
    items.length ? `${label}：${items.map((item) => item.text).join('；')}` : `${label}：（无）`
  return [
    `关系：${person?.relationship ?? '相识'}（好感 ${person?.stats?.affection ?? 30}，信任 ${person?.stats?.trust ?? 30}，熟悉 ${person?.stats?.familiarity ?? 0}）`,
    section('关于对方的印象', card.impressions ?? []),
    section('关于对方的事实', card.facts ?? []),
    section('角色自己透露过的事', card.selfDisclosure ?? []),
    section('关系反思', card.reflections ?? []),
  ].join('\n')
}

/** Episodes selected for one induction, formatted with stable ids. */
export function episodesForInduction(person, limit = 20) {
  const all = person.episodes
  const freshFrom = all.filter((ep) => ep.id > person.lastInductionEpisode)
  const context = all.slice(-limit)
  const ids = new Set(context.map((ep) => ep.id))
  for (const ep of freshFrom) ids.add(ep.id)
  return all
    .filter((ep) => ids.has(ep.id))
    .slice(-Math.max(limit, freshFrom.length))
}
