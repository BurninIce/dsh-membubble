/**
 * Prompt rendering for the bubble layers.
 *
 * The output is plain system-prompt text (the caller registers it with
 * `interpolate: false`). Rendering never reads another person's card: the group
 * layer may show fuzzy styles, the person layer shows that person's own card,
 * and recall shows that person's own episodes.
 */

import { fitsBudget, truncateToBudget } from './budget.js'
import { recallLines } from './retrieve.js'
import { shortStamp, truncate } from './util.js'

const DEFAULT_MAX_CHARS = 1600
const DEFAULT_MAX_TOKENS = 1400

/**
 * @param {{
 *   person: Record<string, any> | null,
 *   group: Record<string, any> | null,
 *   binding: Record<string, any> | null,
 *   episodes: Array<Record<string, any>>,
 *   config: Record<string, any>,
 *   now?: number,
 * }} input
 * @returns {string}
 */
export function renderContext(input) {
  const config = input.config
  const limits = {
    maxChars: config.maxInjectChars ?? DEFAULT_MAX_CHARS,
    maxTokens: config.maxInjectTokens ?? DEFAULT_MAX_TOKENS,
  }
  const groupText = input.group && input.binding?.mode === 'group'
    ? renderGroup(input.group, config, input.person?.id || input.binding?.speakerId)
    : ''
  // The recall block is separate from the person card so an over-budget render
  // can drop recall without touching the card.
  const personText = input.person
    ? renderPerson(input.person, input.binding, [], config)
    : ''
  const recallText = Array.isArray(input.episodes) && input.episodes.length
    ? `【回忆】你想起：\n${recallLines(input.episodes).join('\n')}`
    : ''
  const full = [groupText, personText, recallText].filter(Boolean).join('\n\n')
  if (fitsBudget(full, limits)) return full
  // Drop recall first: it is the least stable part and the card carries the
  // long-term facts.
  const withoutRecall = [groupText, personText].filter(Boolean).join('\n\n')
  if (fitsBudget(withoutRecall, limits)) return withoutRecall
  // If the two blocks still do not fit, keep the person card: losing the group
  // atmosphere is less harmful than losing the facts about the current speaker.
  if (personText) return truncateToBudget(personText, limits)
  return truncateToBudget(groupText, limits)
}

/**
 * @param {Record<string, any>} group
 * @param {Record<string, any>} config
 * @param {string} [excludeId] current speaker; their card is rendered separately
 */
export function renderGroup(group, config, excludeId = '') {
  const lines = [`【群聊气泡】群「${group.name}」`]
  if (group.vibe) lines.push(`氛围：${group.vibe}`)
  if (group.scene) lines.push(`场景：${group.scene}`)
  const events = Array.isArray(group.events) ? group.events.slice(-6) : []
  if (events.length) {
    lines.push('最近群里发生过：')
    for (const event of events) lines.push(`- ${event.summary}`)
  }
  const members = Object.entries(group.members ?? {})
    .map(([id, member]) => ({ id, ...member }))
    // The current speaker's full L1 card is rendered below; leaving them in
    // this list would repeat the same name/style in one injection.
    .filter((member) => !excludeId || String(member.id) !== String(excludeId))
    .sort((a, b) => Number(b.promoted) - Number(a.promoted) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    .slice(0, config.maxGroupMembers ?? 8)
  if (members.length) {
    lines.push('群里的人：')
    for (const member of members) {
      if (member.promoted && member.style) lines.push(`- ${member.name}：${member.style}`)
      else lines.push(`- ${member.name}（还不太熟）`)
    }
  }
  return lines.join('\n')
}

/**
 * @param {Record<string, any>} person
 * @param {Record<string, any> | null} binding
 * @param {Array<Record<string, any>>} episodes
 */
export function renderPerson(person, binding, episodes, config) {
  const lines = []
  const inGroup = binding?.mode === 'group'
  lines.push(inGroup ? `【人物气泡】关于「${person.name}」` : `【人物气泡】你正在和「${person.name}」说话`)
  const promoted = person.promoted === true
  if (!promoted && inGroup) {
    const lastSeen = person.updatedAt ? `，最近一次是 ${shortStamp(person.updatedAt)}` : ''
    const count = person.episodes?.length ?? 0
    lines.push(`还不太熟：只在群里见过${count ? ` ${count} 次` : '几次'}${lastSeen}。`)
    return lines.join('\n')
  }
  lines.push(
    `关系：${person.relationship}｜好感 ${formatStat(person.stats?.affection)}｜信任 ${formatStat(person.stats?.trust)}｜熟悉 ${formatStat(person.stats?.familiarity)}`,
  )
  if (person.style) lines.push(`大致风格：${person.style}`)
  const card = person.card ?? {}
  appendItems(lines, '你记住的关于对方的事', card.facts)
  appendItems(lines, '你对对方的印象', card.impressions)
  appendItems(lines, '你曾对对方说过', card.selfDisclosure)
  appendItems(lines, '关于你们的关系', card.reflections)
  if (episodes?.length) {
    lines.push('【回忆】你想起：')
    for (const line of recallLines(episodes)) lines.push(line)
  }
  return lines.join('\n')
}

function appendItems(lines, label, items) {
  const rows = Array.isArray(items) ? items.slice(-4) : []
  if (!rows.length) return
  lines.push(`${label}：`)
  for (const item of rows) {
    const text = typeof item === 'string' ? item : item?.text
    if (text) lines.push(`- ${truncate(text, 60)}`)
  }
}

function formatStat(value) {
  const n = Number(value)
  return Number.isFinite(n) ? String(Math.round(n)) : '?'
}
