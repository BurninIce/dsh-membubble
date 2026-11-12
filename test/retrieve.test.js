import assert from 'node:assert/strict'
import test from 'node:test'

import { memoryIntent, overlap, recallLines, retrieve, tokens } from '../lib/retrieve.js'
import { emptyPerson } from '../lib/model.js'

const DAY = 86_400_000

function personWithEpisodes() {
  const person = emptyPerson('u1', '小林', 1)
  person.episodes = [
    { id: 1, at: 100 * DAY, summary: '聊了手冲咖啡的冲法', importance: 2, tags: ['咖啡'], userText: '我最近在学手冲', assistantText: '' },
    { id: 2, at: 101 * DAY, summary: '对方说自己养了一只猫', importance: 3, tags: ['猫'], userText: '我家有只猫', assistantText: '' },
    { id: 3, at: 102 * DAY, summary: '一起去了书店', importance: 2, tags: ['书店'], userText: '去书店吧', assistantText: '' },
  ]
  return person
}

test('tokens uses Chinese bigrams and Latin words', () => {
  const list = tokens('我喜欢喝咖啡，也喜欢 OatLatte')
  assert.ok(list.includes('咖啡'))
  assert.ok(list.includes('喜欢'))
  assert.ok(list.includes('oatlatte'))
})

test('overlap measures query coverage', () => {
  const query = tokens('咖啡')
  const doc = tokens('聊了手冲咖啡的冲法')
  assert.equal(overlap(query, doc), 1)
  assert.equal(overlap(tokens('猫'), doc), 0)
})

test('retrieve ranks the matching episode and excludes unrelated ones', () => {
  const person = personWithEpisodes()
  const result = retrieve(person, '咖啡', { now: 110 * DAY, limit: 4 })
  assert.equal(result[0].id, 1)
  assert.ok(!result.some((episode) => episode.id === 2))
})

test('retrieve with no lexical match returns nothing for an unrelated topic', () => {
  const person = personWithEpisodes()
  assert.deepEqual(retrieve(person, '量子力学', { now: 110 * DAY }), [])
})

test('memory questions fall back to recency even without lexical overlap', () => {
  const person = personWithEpisodes()
  assert.equal(memoryIntent('你还记得上次说的吗'), true)
  const result = retrieve(person, '你还记得上次说的吗', { now: 103 * DAY, limit: 2 })
  assert.equal(result.length, 2)
  assert.deepEqual(new Set(result.map((episode) => episode.id)), new Set([2, 3]))
})

test('an empty query yields recent episodes', () => {
  const person = personWithEpisodes()
  const result = retrieve(person, '', { now: 103 * DAY, limit: 1 })
  assert.equal(result[0].id, 3)
})

test('recallLines formats a dated single line', () => {
  const person = personWithEpisodes()
  const lines = recallLines(retrieve(person, '咖啡', { now: 110 * DAY, limit: 1 }))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^- \[\d{2}-\d{2}\] 聊了手冲咖啡的冲法$/u)
})
