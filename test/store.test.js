import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { emptyBindings, emptyGroup, emptyPerson } from '../lib/model.js'
import { BubbleStore } from '../lib/store.js'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-store-'))
}

test('archive files append and remain readable by entity', () => {
  const dir = tempDir()
  try {
    const store = new BubbleStore(dir)
    store.archivePersonEpisodes('u1', [
      { id: 1, summary: '第一条', at: 1, importance: 1 },
      { id: 2, summary: '第二条', at: 2, importance: 2 },
    ])
    store.archivePersonEpisodes('u1', [{ id: 3, summary: '第三条', at: 3, importance: 1 }])
    assert.equal(store.countPersonArchive('u1'), 3)
    const rows = store.readPersonArchive('u1', 2)
    assert.equal(rows.length, 2)
    assert.equal(rows[1].summary, '第三条')
    assert.ok(rows[0].archivedAt > 0)

    store.archiveGroupEvents('g1', [{ id: 1, summary: '群事件', at: 1, importance: 1 }])
    assert.equal(store.countGroupArchive('g1'), 1)
    assert.equal(store.readGroupArchive('g1')[0].summary, '群事件')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ensurePerson promotes an existing unpromoted member when private chat opens their L1', () => {
  const dir = tempDir()
  try {
    const store = new BubbleStore(dir)
    const first = store.ensurePerson('u1', '小林', 1000, { promoted: false })
    assert.equal(first.promoted, false)
    const promoted = store.ensurePerson('u1', '小林', 2000, { promoted: true })
    assert.equal(promoted.promoted, true)
    assert.equal(promoted.promotedAt, 2000)
    assert.equal(new BubbleStore(dir).readPerson('u1').promoted, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('person documents persist across store instances', () => {
  const dir = tempDir()
  try {
    const store = new BubbleStore(dir)
    const person = store.ensurePerson('u1', '小林', 1000, { promoted: true })
    person.card.facts = [{ text: '喜欢咖啡', at: 1, sourceIds: [] }]
    store.writePerson(person)

    const reloaded = new BubbleStore(dir)
    const loaded = reloaded.readPerson('u1')
    assert.equal(loaded.name, '小林')
    assert.equal(loaded.promoted, true)
    assert.deepEqual(loaded.card.facts.map((item) => item.text), ['喜欢咖啡'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt person file is copied aside and read as absent, once', () => {
  const dir = tempDir()
  try {
    const warnings = []
    const store = new BubbleStore(dir, { warn: (message) => warnings.push(message) })
    const file = store.personFile('u1')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{ this is not json', 'utf8')

    assert.equal(store.readPerson('u1'), null)
    assert.equal(store.readPerson('u1'), null)
    const copies = fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.corrupt-'))
    assert.equal(copies.length, 1, 'one preserved copy, not one per read')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /损坏/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('bindings and groups round-trip', () => {
  const dir = tempDir()
  try {
    const store = new BubbleStore(dir)
    const bindings = emptyBindings()
    bindings.sessions.s1 = { mode: 'group', groupId: 'g1', speakerId: 'u1' }
    store.writeBindings(bindings)
    const group = emptyGroup('g1', '测试群', 1)
    store.writeGroup(group)

    const reloaded = new BubbleStore(dir)
    assert.equal(reloaded.readBindings().sessions.s1.groupId, 'g1')
    assert.equal(reloaded.readGroup('g1').name, '测试群')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('person ids with unsafe characters stay distinct', () => {
  const dir = tempDir()
  try {
    const store = new BubbleStore(dir)
    store.writePerson(emptyPerson('a/b', '甲', 1))
    store.writePerson(emptyPerson('a?b', '乙', 1))
    assert.equal(store.readPerson('a/b').name, '甲')
    assert.equal(store.readPerson('a?b').name, '乙')
    assert.notEqual(store.personFile('a/b'), store.personFile('a?b'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
