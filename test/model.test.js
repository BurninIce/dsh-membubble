import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addEpisode,
  addGroupBuffer,
  applyGroupUpdate,
  applyInduction,
  cardDigest,
  emptyGroup,
  emptyPerson,
  forgetOld,
  promotePerson,
  relationshipFor,
  sanitizeGroupText,
  touchMember,
  trimEpisodes,
  trimGroupEvents,
} from '../lib/model.js'

test('relationship tiers derive from weighted stats', () => {
  assert.equal(relationshipFor({ affection: 0, trust: 0, familiarity: 0 }), '陌生')
  assert.equal(relationshipFor({ affection: 30, trust: 30, familiarity: 0 }), '相识')
  assert.equal(relationshipFor({ affection: 50, trust: 50, familiarity: 40 }), '熟络')
  assert.equal(relationshipFor({ affection: 70, trust: 70, familiarity: 60 }), '亲密')
  assert.equal(relationshipFor({ affection: 95, trust: 95, familiarity: 90 }), '倾心')
})

test('emptyPerson starts at 相识 and is not promoted', () => {
  const person = emptyPerson('u1', '小林', 1000)
  assert.equal(person.relationship, '相识')
  assert.equal(person.promoted, false)
  assert.deepEqual(person.stats, { affection: 30, trust: 30, familiarity: 0 })
  assert.deepEqual(person.episodes, [])
})

test('addEpisode assigns increasing ids and caps the store', () => {
  const person = emptyPerson('u1', '小林', 1)
  const first = addEpisode(person, { summary: '一起吃了饭', importance: 2 }, 10)
  const second = addEpisode(person, { summary: '聊了咖啡', importance: 3 }, 20)
  assert.equal(first.id, 1)
  assert.equal(second.id, 2)
  assert.equal(person.episodes.length, 2)
})

test('forgetOld drops only low-importance old episodes', () => {
  const person = emptyPerson('u1', '小林', 1)
  const day = 86_400_000
  addEpisode(person, { summary: '旧的低权重', importance: 1, at: 1 }, 1)
  addEpisode(person, { summary: '旧的高权重', importance: 3, at: 1 }, 1)
  addEpisode(person, { summary: '新的低权重', importance: 1, at: 40 * day }, 40 * day)
  const removed = forgetOld(person, { days: 30, now: 40 * day })
  assert.equal(removed.count, 1)
  assert.equal(removed.removed[0].summary, '旧的低权重')
  assert.deepEqual(person.episodes.map((ep) => ep.summary), ['旧的高权重', '新的低权重'])
})

test('trimEpisodes evicts low-importance episodes before key ones', () => {
  const person = emptyPerson('u1', '小林', 1)
  for (let i = 0; i < 4; i += 1) addEpisode(person, { summary: `低 ${i}`, importance: 1 }, i + 1)
  addEpisode(person, { summary: '关键', importance: 3 }, 10)
  const removed = trimEpisodes(person, 2)
  assert.equal(person.episodes.length, 2)
  assert.equal(person.episodes.some((episode) => episode.summary === '关键'), true)
  assert.equal(removed.length, 3)
  assert.equal(removed.some((episode) => episode.summary === '关键'), false)
})

test('trimGroupEvents returns the overflow instead of deleting it silently', () => {
  const group = emptyGroup('g1', '测试群', 1)
  group.events = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, at: i, summary: `事件 ${i}`, importance: 1 }))
  const removed = trimGroupEvents(group, 2)
  assert.equal(group.events.length, 2)
  assert.equal(removed.length, 3)
  assert.deepEqual(removed.map((event) => event.summary), ['事件 0', '事件 1', '事件 2'])
})

test('applyInduction bounds movement and replaces lists when supplied', () => {
  const person = emptyPerson('u1', '小林', 1)
  const first = applyInduction(person, {
    affection: 100,
    trust: 100,
    familiarity: 100,
    style: '话多，爱反问',
    facts: ['喜欢手冲咖啡'],
    impressions: ['说话直接'],
    selfDisclosure: ['她会做红茶'],
    reflections: ['相处轻松'],
  }, { at: 2, episodeIds: [1] })
  assert.equal(person.stats.affection, 38)
  assert.equal(person.stats.trust, 38)
  assert.equal(person.stats.familiarity, 6)
  assert.equal(person.style, '话多，爱反问')
  assert.deepEqual(person.card.facts.map((i) => i.text), ['喜欢手冲咖啡'])
  assert.deepEqual(first.record.episodeIds, [1])

  // A later complete list retires an old item.
  applyInduction(person, { facts: ['搬去了新城市'] }, { at: 3, episodeIds: [2] })
  assert.deepEqual(person.card.facts.map((i) => i.text), ['搬去了新城市'])
  assert.equal(person.stats.affection, 38)

  // A missing field keeps the previous list.
  applyInduction(person, { affection: 40 }, { at: 4, episodeIds: [3] })
  assert.deepEqual(person.card.facts.map((i) => i.text), ['搬去了新城市'])
})

test('applyInduction enforces item caps and 40-char texts', () => {
  const person = emptyPerson('u1', '小林', 1)
  applyInduction(person, {
    facts: Array.from({ length: 20 }, (_, i) => `事实 ${i}`),
  }, { at: 2, episodeIds: [] })
  assert.equal(person.card.facts.length, 6)
  const long = '很'.repeat(100)
  applyInduction(person, { facts: [long] }, { at: 3, episodeIds: [] })
  assert.ok(person.card.facts[0].text.length <= 48)
})

test('promotePerson is idempotent and records the time', () => {
  const person = emptyPerson('u1', '小林', 1)
  assert.equal(promotePerson(person, 50), true)
  assert.equal(person.promoted, true)
  assert.equal(person.promotedAt, 50)
  assert.equal(promotePerson(person, 60), false)
})

test('touchMember never invents a style and keeps lastSeen current', () => {
  const group = emptyGroup('g1', '测试群', 1)
  touchMember(group, { id: 'u1', name: '小林', promoted: false }, 10)
  assert.deepEqual(group.members.u1, { name: '小林', style: '', lastSeen: 10, promoted: false })
  touchMember(group, { id: 'u1', style: '话多', promoted: true }, 20)
  assert.equal(group.members.u1.style, '话多')
  assert.equal(group.members.u1.promoted, true)
  assert.equal(group.members.u1.lastSeen, 20)
})

test('group text sanitizer removes every known member name', () => {
  const names = ['阿川', '小林']
  assert.equal(
    sanitizeGroupText('阿川和小林争论了一个技术方案，阿川很激动。', names),
    '有人和有人争论了一个技术方案，有人很激动。',
  )
})

test('applyGroupUpdate strips names, caps events and clears the buffer', () => {
  const group = emptyGroup('g1', '测试群', 1)
  touchMember(group, { id: 'u1', name: '阿川', promoted: true }, 1)
  addGroupBuffer(group, '阿川：今天聊技术', 2)
  const result = applyGroupUpdate(
    group,
    {
      vibe: '阿川很活跃，偏技术向',
      scene: '在群里聊技术',
      events: [
        { summary: '阿川争论过一个技术方案', importance: 2 },
        { summary: '有人分享了咖啡', importance: 1 },
      ],
    },
    { at: 10, memberNames: ['阿川'] },
  )
  assert.equal(group.vibe, '有人很活跃，偏技术向')
  assert.equal(group.events.length, 2)
  assert.equal(group.events[0].summary, '有人争论过一个技术方案')
  assert.equal(result.added, 2)
  assert.deepEqual(group.buffer, [])
  assert.equal(group.messagesSinceUpdate, 0)
})

test('an empty group summary keeps the buffer instead of clearing it', () => {
  const group = emptyGroup('g1', '测试群', 1)
  addGroupBuffer(group, '有人聊了几句', 2)
  const result = applyGroupUpdate(group, {}, { at: 10, memberNames: [] })
  assert.equal(result.accepted, false)
  assert.equal(group.buffer.length, 1)
  assert.equal(group.lastGroupUpdateAt, 0)
})

test('cardDigest includes every card section with a stable shape', () => {
  const person = emptyPerson('u1', '小林', 1)
  person.card.facts = [{ text: '喜欢咖啡', at: 1, sourceIds: [] }]
  const digest = cardDigest(person)
  assert.match(digest, /关系：相识/)
  assert.match(digest, /关于对方的事实：喜欢咖啡/)
  assert.match(digest, /关于对方的印象：（无）/)
})
