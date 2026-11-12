import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { BubbleEngine, isGreeting } from '../lib/engine.js'
import { BubbleStore } from '../lib/store.js'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime()

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-membubble-'))
}

/**
 * A scripted judge. It routes on stable phrases in each prompt, which also
 * proves the engine calls the right prompt for the right job.
 */
function fakeComplete(options = {}) {
  const calls = []
  const complete = async (input) => {
    calls.push(input.user)
    if (input.user.includes('判断**当前话题是否已经结束**')) {
      return JSON.stringify({
        action: 'close',
        worth: true,
        episode: {
          summary: options.summary ?? '他聊起自己最近在学手冲咖啡',
          scene: '线上聊天',
          emotion: '平静',
          importance: 2,
          tags: ['咖啡'],
        },
      })
    }
    if (input.user.includes('归档关于')) {
      const aboutJie = input.user.includes('阿杰') || input.user.includes('小美')
      return JSON.stringify({
        affection: options.affection ?? 46,
        trust: 42,
        familiarity: 12,
        style: aboutJie ? '温和，话少' : '话多，爱反问',
        facts: aboutJie ? ['家里养了一只猫'] : ['最近在学手冲咖啡'],
        impressions: aboutJie ? ['偏安静'] : ['说话直接'],
        selfDisclosure: ['她会做红茶'],
        reflections: [],
      })
    }
    if (input.user.includes('群体层')) {
      return JSON.stringify({
        vibe: '小林很活跃，偏技术向',
        scene: '在群里聊咖啡',
        events: [{ summary: '小林分享了一家咖啡店', importance: 2 }],
      })
    }
    if (input.user.includes('群友')) {
      return JSON.stringify({ promote: true, why: '聊过多次，有稳定印象' })
    }
    return '{}'
  }
  return { complete, calls }
}

function makeEngine(overrides = {}, completeOptions = {}) {
  const dir = tempDir()
  const config = resolveConfig({
    agentName: '角色',
    dataDir: dir,
    boundaryCheck: true,
    inductEvery: 1,
    groupEnabled: true,
    groupUpdateEvery: 1,
    groupMinIntervalSec: 0,
    promotionEnabled: true,
    promotionMinEpisodes: 1,
    ...overrides,
  })
  const store = new BubbleStore(resolveConfig({ dataDir: dir, namespace: config.namespace }).dataDir)
  const fake = fakeComplete(completeOptions)
  const engine = new BubbleEngine({
    store,
    config,
    complete: fake.complete,
    now: () => NOW,
    logger: { info() {}, warn() {} },
  })
  return { engine, store, dir, fake, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('isGreeting separates pleasantries from substance', () => {
  assert.equal(isGreeting('你好'), true)
  assert.equal(isGreeting('哈哈哈'), true)
  assert.equal(isGreeting('早上好呀'), true)
  assert.equal(isGreeting('我最近在学手冲咖啡'), false)
})

test('personal turn: greeting buffers, then a closed topic becomes an episode and a card', async () => {
  const ctx = makeEngine()
  try {
    const first = await ctx.engine.observeTurn({ sessionId: 's1', userText: '你好', assistantText: '……' })
    assert.equal(first.action, 'buffered')
    assert.equal(ctx.fake.calls.length, 0)

    const second = await ctx.engine.observeTurn({
      sessionId: 's1',
      userText: '我最近在学手冲咖啡',
      assistantText: '哦？说说看。',
    })
    assert.equal(second.action, 'closed')
    assert.equal(second.episode.id, 1)

    const person = ctx.store.readPerson('owner')
    assert.equal(person.promoted, true, 'the default personal speaker is already a person bubble')
    assert.equal(person.episodes.length, 1)
    assert.equal(person.episodes[0].summary, '他聊起自己最近在学手冲咖啡')
    assert.deepEqual(person.card.facts.map((i) => i.text), ['最近在学手冲咖啡'])
    assert.equal(person.style, '话多，爱反问')
    assert.equal(person.interactionCount, 1)
    assert.deepEqual(person.pending, [])
    assert.ok(person.inductions.length >= 1)

    const blocks = ctx.engine.context({ sessionId: 's1', query: '咖啡' })
    assert.match(blocks, /【人物气泡】你正在和「你」说话/)
    assert.match(blocks, /最近在学手冲咖啡/)
    assert.match(blocks, /【回忆】/)

    const recalled = ctx.engine.recall({ sessionId: 's1', query: '咖啡' })
    assert.equal(recalled.gated, false)
    assert.equal(recalled.episodes.length, 1)

    // Persistence: a fresh store over the same directory sees the same person.
    const reloaded = new BubbleStore(resolveConfig({ dataDir: ctx.dir }).dataDir)
    assert.equal(reloaded.readPerson('owner').episodes.length, 1)
  } finally {
    ctx.cleanup()
  }
})

test('group mode: member promoted only after the judge approves, base stats follow induction', async () => {
  const ctx = makeEngine()
  try {
    ctx.engine.bind('s1', {
      mode: 'group',
      groupId: 'g1',
      groupName: '测试群',
      speakerId: 'u1',
      speakerName: '小林',
    })
    await ctx.engine.observeTurn({ sessionId: 's1', userText: '今天去喝了手冲', assistantText: '哪家？' })
    await ctx.engine.observeTurn({ sessionId: 's1', userText: '公司楼下新开的', assistantText: '味道如何？' })

    const person = ctx.store.readPerson('u1')
    assert.equal(person.promoted, true)
    assert.equal(person.episodes.length, 2)
    assert.deepEqual(person.card.facts.map((i) => i.text), ['最近在学手冲咖啡'])
    assert.equal(person.relationship, '相识')

    const group = ctx.store.readGroup('g1')
    assert.equal(group.members.u1.promoted, true)
    assert.equal(group.members.u1.style, '话多，爱反问')
    assert.equal(group.vibe, '有人很活跃，偏技术向', 'member names are scrubbed from group prose')
    assert.equal(group.events.length, 1)
    assert.equal(group.events[0].summary, '有人分享了一家咖啡店')
    assert.deepEqual(group.buffer, [])

    const blocks = ctx.engine.context({ sessionId: 's1', query: '咖啡' })
    assert.match(blocks, /【群聊气泡】群「测试群」/)
    assert.match(blocks, /【人物气泡】关于「小林」/)
    assert.match(blocks, /最近在学手冲咖啡/)
    assert.doesNotMatch(blocks, /小林很活跃/)
  } finally {
    ctx.cleanup()
  }
})

test('large group: only the focus board enters the person pipeline', async () => {
  const ctx = makeEngine({
    focusActive: 2,
    focusBuffer: 2,
    groupUpdateEvery: 1000,
    groupMinIntervalSec: 0,
    boundaryCheck: false,
    maxInjectTokens: 300,
  })
  try {
    ctx.engine.bind('s1', { mode: 'group', groupId: 'g1', groupName: '大群' })
    for (let i = 0; i < 200; i += 1) {
      await ctx.engine.observeTurn({
        sessionId: 's1',
        speaker: { id: `u${i}`, name: `成员${String(i).padStart(3, '0')}` },
        userText: `我在说第 ${i} 件事`,
        assistantText: '嗯。',
      })
    }
    const group = ctx.store.readGroup('g1')
    assert.equal(group.focus.length, 60)
    assert.equal(Object.keys(group.members).length, 4)
    let persons = 0
    for (let i = 0; i < 200; i += 1) {
      if (ctx.store.readPerson(`u${i}`)) persons += 1
    }
    assert.equal(persons, 4, 'active and buffer speakers get person bubbles; noise/ignored do not')
    const status = ctx.engine.status('s1')
    assert.ok(status.inject.tokens <= 300)
    assert.ok(status.inject.chars <= status.inject.maxChars)
  } finally {
    ctx.cleanup()
  }
})

test('buffer records the event without induction or promotion', async () => {
  const ctx = makeEngine({ focusActive: 1, focusBuffer: 1, inductEvery: 1, promotionMinEpisodes: 1 })
  try {
    ctx.engine.bind('s1', { mode: 'group', groupId: 'g1', groupName: '测试群' })
    for (const name of ['A', 'B', 'C']) {
      await ctx.engine.observeTurn({
        sessionId: 's1',
        speaker: { id: name, name },
        userText: `${name} 在说一件具体的事`,
        assistantText: '嗯。',
      })
    }
    const active = ctx.store.readPerson('A')
    const buffer = ctx.store.readPerson('B')
    assert.equal(active.promoted, true)
    assert.equal(active.episodes.length, 1)
    assert.ok(active.card.facts.length > 0)
    assert.equal(buffer.promoted, false)
    assert.equal(buffer.episodes.length, 1, 'buffer still records the event')
    assert.equal(buffer.card.facts.length, 0, 'buffer does not run induction')
    assert.equal(ctx.store.readPerson('C'), null, 'outside the focus board has no person bubble')
  } finally {
    ctx.cleanup()
  }
})

test('group noise is ignored before focus, buffer and person creation', async () => {
  const ctx = makeEngine()
  try {
    ctx.engine.bind('s1', { mode: 'group', groupId: 'g1', groupName: '测试群', speakerId: 'u1', speakerName: '小林' })
    const ignored = await ctx.engine.observeTurn({ sessionId: 's1', userText: '6666', assistantText: '？' })
    assert.equal(ignored.action, 'ignored-noise')
    const group = ctx.store.readGroup('g1')
    assert.equal(group.focus.length, 0)
    assert.equal(group.buffer.length, 0)
    assert.equal(ctx.store.readPerson('u1'), null)

    const direct = await ctx.engine.observeTurn({ sessionId: 's1', userText: '@角色 6666', assistantText: '在。' })
    assert.equal(direct.role, 'active')
    assert.equal(ctx.store.readGroup('g1').focus.length, 1)
    assert.ok(ctx.store.readPerson('u1'))
  } finally {
    ctx.cleanup()
  }
})

test('archive keeps evicted episodes searchable after the active cap', async () => {
  const ctx = makeEngine({ boundaryCheck: false })
  try {
    for (let i = 0; i < 405; i += 1) {
      ctx.engine.remember({ sessionId: 's1', text: `线索${i}`, importance: i === 0 ? 3 : 1 })
    }
    const person = ctx.store.readPerson('owner')
    assert.equal(person.episodes.length, 400)
    assert.equal(ctx.store.countPersonArchive('owner'), 5)
    assert.equal(person.episodes.some((episode) => episode.summary === '线索0'), true)
    const recalled = ctx.engine.recall({ sessionId: 's1', query: '线索1', limit: 5 })
    assert.ok(recalled.episodes.some((episode) => episode.summary === '线索1'), 'archived episode is still recallable')
  } finally {
    ctx.cleanup()
  }
})

test('privacy: two people in one group never see each other’s facts', async () => {
  const ctx = makeEngine()
  try {
    ctx.engine.bind('s1', { mode: 'group', groupId: 'g1', groupName: '测试群', speakerId: 'u1', speakerName: '小林' })
    ctx.engine.bind('s2', { mode: 'group', groupId: 'g1', groupName: '测试群', speakerId: 'u2', speakerName: '阿杰' })
    await ctx.engine.observeTurn({ sessionId: 's1', userText: '我在学手冲咖啡', assistantText: '嗯。' })
    await ctx.engine.observeTurn({ sessionId: 's2', userText: '我家猫今天很闹', assistantText: '是吗。' })

    const forLin = ctx.engine.context({ sessionId: 's1', query: '咖啡' })
    const forJie = ctx.engine.context({ sessionId: 's2', query: '猫' })
    assert.match(forLin, /最近在学手冲咖啡/)
    assert.doesNotMatch(forLin, /养了一只猫/)
    assert.match(forJie, /养了一只猫/)
    assert.doesNotMatch(forJie, /手冲咖啡/)
  } finally {
    ctx.cleanup()
  }
})

test('an unpromoted group member is gated to name + recency, even if a card exists', async () => {
  const ctx = makeEngine({ promotionMinEpisodes: 99 })
  try {
    ctx.engine.bind('s1', { mode: 'group', groupId: 'g2', groupName: '另一个群', speakerId: 'u3', speakerName: '小美' })
    await ctx.engine.observeTurn({ sessionId: 's1', userText: '我最近在学手冲咖啡', assistantText: '嗯。' })
    const person = ctx.store.readPerson('u3')
    assert.equal(person.promoted, false)
    assert.ok(person.card.facts.length > 0, 'memory is still stored as promotion material')

    const blocks = ctx.engine.context({ sessionId: 's1', query: '咖啡' })
    assert.match(blocks, /还不太熟/)
    assert.doesNotMatch(blocks, /最近在学手冲咖啡/)
    assert.doesNotMatch(blocks, /关系：/)

    const recalled = ctx.engine.recall({ sessionId: 's1', query: '咖啡' })
    assert.equal(recalled.gated, true)
    assert.match(recalled.episodes[0].summary, /还不太熟/)
  } finally {
    ctx.cleanup()
  }
})

test('a Name： prefix selects that speaker when enabled', async () => {
  const ctx = makeEngine({ speakerPrefix: true, defaultSpeakerId: 'owner' }, {})
  try {
    await ctx.engine.observeTurn({ sessionId: 's9', userText: '小林：我在学手冲咖啡', assistantText: '嗯。' })
    const person = ctx.store.readPerson('name:小林')
    assert.ok(person, 'prefix speaker gets its own bubble')
    assert.equal(person.name, '小林')
    assert.match(ctx.engine.context({ sessionId: 's9' }), /你正在和「小林」说话/)
  } finally {
    ctx.cleanup()
  }
})

test('remember and forget operate on the bound speaker', async () => {
  const ctx = makeEngine()
  try {
    ctx.engine.bind('s1', { mode: 'personal', speakerId: 'owner', speakerName: '你' })
    const saved = ctx.engine.remember({ sessionId: 's1', text: '他下个月要搬去杭州', importance: 3 })
    assert.equal(saved.episode.summary, '他下个月要搬去杭州')
    assert.equal(saved.person.episodes.length, 1)
    assert.equal(ctx.engine.recall({ sessionId: 's1', query: '杭州' }).episodes.length, 1)
    const removed = ctx.engine.forget({ sessionId: 's1', episodeId: saved.episode.id })
    assert.equal(removed.removed, true)
    assert.equal(ctx.store.readPerson('owner').episodes.length, 0)
  } finally {
    ctx.cleanup()
  }
})

test('remember does not bypass promotion in a group', () => {
  const ctx = makeEngine({ promotionMinEpisodes: 99 })
  try {
    ctx.engine.bind('s1', {
      mode: 'group',
      groupId: 'g3',
      groupName: '测试群',
      speakerId: 'u9',
      speakerName: '小美',
    })
    const saved = ctx.engine.remember({ sessionId: 's1', text: '她下周要考试', importance: 2 })
    assert.equal(saved.person.promoted, false)
    assert.equal(saved.promoted, false)
    const recalled = ctx.engine.recall({ sessionId: 's1', query: '考试' })
    assert.equal(recalled.gated, true)
    assert.match(recalled.episodes[0].summary, /还不太熟/)
  } finally {
    ctx.cleanup()
  }
})

test('a failed judge keeps the buffer and never throws', async () => {
  const dir = tempDir()
  const config = resolveConfig({ dataDir: dir, inductEvery: 5, promotionEnabled: false })
  const store = new BubbleStore(config.dataDir)
  const engine = new BubbleEngine({
    store,
    config,
    complete: async () => {
      throw new Error('model offline')
    },
    now: () => NOW,
    logger: { info() {}, warn() {} },
  })
  try {
    const result = await engine.observeTurn({ sessionId: 's1', userText: '我最近在学手冲咖啡', assistantText: '嗯。' })
    assert.equal(result.ok, true)
    assert.equal(result.action, 'buffered')
    assert.equal(store.readPerson('owner').pending.length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('bind/unbind round-trips through the bindings document', () => {
  const ctx = makeEngine()
  try {
    const binding = ctx.engine.bind('s1', { mode: 'group', groupId: 'g1', groupName: '测试群', speakerId: 'u1', speakerName: '小林' })
    assert.equal(binding.mode, 'group')
    assert.equal(ctx.engine.bindingFor('s1').groupId, 'g1')
    assert.equal(ctx.engine.unbind('s1'), true)
    assert.equal(ctx.engine.bindingFor('s1'), null)
  } finally {
    ctx.cleanup()
  }
})

test('status and summary expose the bubble state without a full dump', () => {
  const ctx = makeEngine()
  try {
    ctx.engine.bind('s1', { mode: 'personal', speakerId: 'owner', speakerName: '你' })
    const status = ctx.engine.status('s1')
    assert.equal(status.speakerName, '你')
    assert.equal(status.person, null)
    const summary = ctx.engine.summary('s1')
    assert.match(summary, /未绑定|私聊/)
    assert.match(summary, /人物气泡/)
  } finally {
    ctx.cleanup()
  }
})
