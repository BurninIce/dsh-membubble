import assert from 'node:assert/strict'
import test from 'node:test'

import { emptyGroup, emptyPerson, touchMember } from '../lib/model.js'
import { renderContext, renderGroup, renderPerson } from '../lib/render.js'

function config(overrides = {}) {
  return { maxInjectChars: 1600, maxGroupMembers: 8, ...overrides }
}

test('group block shows vibe, impersonal events and only promoted styles', () => {
  const group = emptyGroup('g1', '测试群', 1)
  group.vibe = '活跃，偏技术向'
  group.events = [{ id: 1, at: 1, summary: '有人争论过一个技术方案', importance: 2 }]
  touchMember(group, { id: 'u1', name: '阿川', style: '话多，爱抬杠', promoted: true }, 1)
  touchMember(group, { id: 'u2', name: '小林', promoted: false }, 2)
  const text = renderGroup(group, config())
  assert.match(text, /【群聊气泡】群「测试群」/)
  assert.match(text, /氛围：活跃，偏技术向/)
  assert.match(text, /有人争论过一个技术方案/)
  assert.match(text, /阿川：话多，爱抬杠/)
  assert.match(text, /小林（还不太熟）/)
  assert.ok(!text.includes('小林：'))
})

test('an unpromoted group member gets name and recency only', () => {
  const person = emptyPerson('u2', '小林', 1)
  person.card.facts = [{ text: '喜欢手冲咖啡', at: 1, sourceIds: [] }]
  person.promoted = false
  const text = renderPerson(person, { mode: 'group' }, [], config())
  assert.match(text, /关于「小林」/)
  assert.match(text, /还不太熟/)
  assert.ok(!text.includes('喜欢手冲咖啡'))
  assert.ok(!text.includes('关系：'))
})

test('a promoted person gets stats, style, card and recall', () => {
  const person = emptyPerson('u1', '阿川', 1, { promoted: true })
  person.stats = { affection: 40, trust: 45, familiarity: 12 }
  person.relationship = '相识'
  person.style = '话多，爱反问'
  person.card.facts = [{ text: '喜欢手冲咖啡', at: 1, sourceIds: [] }]
  person.card.impressions = [{ text: '说话直接', at: 1, sourceIds: [] }]
  person.card.selfDisclosure = [{ text: '她会做红茶', at: 1, sourceIds: [] }]
  const episodes = [{ id: 1, at: 1, summary: '聊了咖啡的冲法' }]
  const text = renderPerson(person, { mode: 'group' }, episodes, config())
  assert.match(text, /关系：相识｜好感 40｜信任 45｜熟悉 12/)
  assert.match(text, /大致风格：话多，爱反问/)
  assert.match(text, /喜欢手冲咖啡/)
  assert.match(text, /说话直接/)
  assert.match(text, /她会做红茶/)
  assert.match(text, /【回忆】你想起：/)
  assert.match(text, /聊了咖啡的冲法/)
})

test('personal mode uses the private-chat header', () => {
  const person = emptyPerson('owner', '你', 1, { promoted: true })
  const text = renderPerson(person, { mode: 'personal' }, [], config())
  assert.match(text, /你正在和「你」说话/)
})

test('group block can exclude the current speaker to avoid duplicate style', () => {
  const group = emptyGroup('g1', '测试群', 1)
  touchMember(group, { id: 'u1', name: '阿川', style: '话多', promoted: true }, 1)
  touchMember(group, { id: 'u2', name: '小林', style: '温和', promoted: true }, 1)
  const text = renderGroup(group, config(), 'u1')
  assert.doesNotMatch(text, /阿川/)
  assert.match(text, /小林/)
})

test('renderContext combines group and person without other people facts', () => {
  const group = emptyGroup('g1', '测试群', 1)
  group.vibe = '活跃'
  touchMember(group, { id: 'u1', name: '阿川', style: '话多', promoted: true }, 1)
  touchMember(group, { id: 'u2', name: '小林', style: '温和', promoted: true }, 1)
  const person = emptyPerson('u1', '阿川', 1, { promoted: true })
  person.card.facts = [{ text: '喜欢手冲咖啡', at: 1, sourceIds: [] }]
  const text = renderContext({
    person,
    group,
    binding: { mode: 'group', groupId: 'g1' },
    episodes: [],
    config: config(),
  })
  assert.match(text, /【群聊气泡】/)
  assert.match(text, /【人物气泡】关于「阿川」/)
  assert.match(text, /喜欢手冲咖啡/)
  assert.ok(!text.includes('- 阿川：话多'), 'current speaker is not repeated in the group member list')
  // Other members appear only as fuzzy styles, never with their own facts.
  assert.ok(!text.includes('养猫'))
})

test('over budget keeps the person card over the group atmosphere', () => {
  const person = emptyPerson('u1', '阿川', 1, { promoted: true })
  person.card.facts = [{ text: '喜欢手冲咖啡', at: 1, sourceIds: [] }]
  const group = emptyGroup('g1', '测试群', 1)
  group.vibe = '很活跃'.repeat(80)
  const text = renderContext({
    person,
    group,
    binding: { mode: 'group' },
    episodes: [],
    config: config({ maxInjectChars: 220, maxInjectTokens: 120 }),
  })
  assert.match(text, /喜欢手冲咖啡/)
  assert.ok(text.length <= 220)
  assert.ok(!text.includes('【群聊气泡】'))
})

test('renderContext drops recall before the card when over budget', () => {
  const person = emptyPerson('u1', '阿川', 1, { promoted: true })
  person.card.facts = [{ text: '喜欢手冲咖啡', at: 1, sourceIds: [] }]
  const episodes = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    at: 1,
    summary: `一段很长的回忆 ${i} ${'内容'.repeat(30)}`,
  }))
  const text = renderContext({
    person,
    group: null,
    binding: { mode: 'personal' },
    episodes,
    config: config({ maxInjectChars: 300 }),
  })
  assert.match(text, /喜欢手冲咖啡/)
  assert.ok(!text.includes('【回忆】'))
  assert.ok(text.length <= 300)
})
