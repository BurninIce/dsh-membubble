/**
 * Large-group scale check.
 *
 * 1000 distinct speakers, 2000 incoming messages, 200 of them noise. The real
 * engine is driven with a deterministic fake group summarizer. It checks that:
 * - the focus board and member index stay bounded;
 * - only active/buffer speakers get person documents;
 * - group events stay capped and overflow into the archive;
 * - the injected section stays inside a small token budget.
 *
 * This is not a unit test and does not call a model. Run with:
 *   node tests/scale/group.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { estimateTokens } from '../../lib/budget.js'
import { resolveConfig } from '../../lib/config.js'
import { BubbleEngine } from '../../lib/engine.js'
import { BubbleStore } from '../../lib/store.js'

const MESSAGES = 2000
const MEMBERS = 1000
const NOISE_EVERY = 10
const SAMPLES = new Set([500, 1000, 2000])
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'membubble-group-scale-'))
const config = resolveConfig({
  agentName: '角色',
  dataDir: dir,
  boundaryCheck: false,
  groupUpdateEvery: 20,
  groupMinIntervalSec: 0,
  focusActive: 5,
  focusBuffer: 5,
  maxInjectTokens: 400,
  maxInjectChars: 600,
})
const store = new BubbleStore(dir)
let groupCalls = 0
let valid = 0
let noise = 0

const complete = async (input) => {
  if (input.user.includes('群体层')) {
    groupCalls += 1
    return JSON.stringify({
      vibe: '活跃，偏技术向',
      scene: '在群里聊日常',
      events: [{ summary: `群事件 ${groupCalls}`, importance: 1 }],
    })
  }
  return '{}'
}

const engine = new BubbleEngine({
  store,
  config,
  complete,
  logger: { info() {}, warn: () => {} },
})
engine.bind('s1', { mode: 'group', groupId: 'g1', groupName: '千人群' })

function sample(at) {
  const group = store.readGroup('g1')
  const text = engine.context({ sessionId: 's1', query: '日常' })
  return {
    messages: at,
    valid,
    noise,
    tokens: estimateTokens(text),
    chars: text.length,
    groupEvents: group.events.length,
    groupArchive: store.countGroupArchive('g1'),
    focus: group.focus.length,
    members: Object.keys(group.members).length,
    buffer: group.buffer.length,
  }
}

const samples = []
const started = Date.now()
for (let i = 1; i <= MESSAGES; i += 1) {
  if (i % NOISE_EVERY === 0) {
    noise += 1
    await engine.observeTurn({
      sessionId: 's1',
      speaker: { id: `u${i % MEMBERS}`, name: `成员${String(i % MEMBERS).padStart(4, '0')}` },
      userText: '6666',
      assistantText: '……',
    })
  } else {
    valid += 1
    await engine.observeTurn({
      sessionId: 's1',
      speaker: { id: `u${i % MEMBERS}`, name: `成员${String(i % MEMBERS).padStart(4, '0')}` },
      userText: `第 ${i} 条有效发言，讨论一个具体问题。`,
      assistantText: '嗯。',
    })
  }
  if (SAMPLES.has(i)) samples.push(sample(i))
}
const elapsedMs = Date.now() - started
const group = store.readGroup('g1')
const personFiles = fs
  .readdirSync(path.join(dir, 'persons'))
  .filter((name) => name.endsWith('.json')).length

console.log(
  JSON.stringify(
    {
      messages: MESSAGES,
      members: MEMBERS,
      noise,
      valid,
      elapsedMs,
      groupSummaryCalls: groupCalls,
      budget: { maxTokens: config.maxInjectTokens, maxChars: config.maxInjectChars },
      samples,
      final: {
        persons: personFiles,
        focus: group.focus.length,
        members: Object.keys(group.members).length,
        groupEvents: group.events.length,
        groupArchive: store.countGroupArchive('g1'),
        groupBuffer: group.buffer.length,
        contextTokens: estimateTokens(engine.context({ sessionId: 's1', query: '日常' })),
        archiveReadable: store.readGroupArchive('g1', 200).length,
      },
    },
    null,
    2,
  ),
)
fs.rmSync(dir, { recursive: true, force: true })
