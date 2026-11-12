/**
 * Long-running personal-chat scale check.
 *
 * Runs 5000 closed topics through the real engine, with a deterministic fake
 * judge. It checks that:
 * - the injected section stays inside the token/char budget;
 * - the active episode list stays bounded;
 * - older episodes move to the archive and remain recallable;
 * - a late high-importance episode stays active.
 *
 * This is not a unit test and does not call a model. Run with:
 *   node tests/scale/personal.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { estimateTokens } from '../../lib/budget.js'
import { resolveConfig } from '../../lib/config.js'
import { BubbleEngine } from '../../lib/engine.js'
import { BubbleStore } from '../../lib/store.js'

const TURNS = 5000
const SAMPLE_AT = new Set([100, 1000, 3000, 5000])
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'membubble-longrun-'))
const config = resolveConfig({
  agentName: '角色',
  dataDir: dir,
  boundaryCheck: true,
  inductEvery: 100,
  forgetDays: 3650,
  retrieveLimit: 4,
})
const store = new BubbleStore(dir)
let boundaryCalls = 0
let inductionCalls = 0
let turn = 0

const complete = async (input) => {
  if (input.user.includes('当前话题是否已经结束')) {
    boundaryCalls += 1
    turn += 1
    return JSON.stringify({
      action: 'close',
      worth: true,
      episode: {
        summary: `第 ${turn} 轮的事件`,
        scene: '日常聊天',
        emotion: '平静',
        importance: turn % 500 === 0 ? 3 : 1,
        tags: [],
      },
    })
  }
  if (input.user.includes('归档关于')) {
    inductionCalls += 1
    return JSON.stringify({
      affection: 46,
      trust: 42,
      familiarity: 12,
      style: '话多，爱反问',
      facts: ['长期事实：在学手冲咖啡'],
      impressions: ['说话直接'],
      selfDisclosure: ['她会做红茶'],
      reflections: [],
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
engine.bind('s1', { mode: 'personal', speakerId: 'owner', speakerName: '阿川' })

const samples = []
const started = Date.now()
for (let i = 1; i <= TURNS; i += 1) {
  await engine.observeTurn({
    sessionId: 's1',
    userText: `第 ${i} 轮：我在说一件具体的事，编号 ${i}。`,
    assistantText: '嗯，继续说。',
  })
  if (SAMPLE_AT.has(i)) {
    const text = engine.context({ sessionId: 's1', query: '事件' })
    samples.push({
      turn: i,
      tokens: estimateTokens(text),
      chars: text.length,
      active: store.readPerson('owner').episodes.length,
      archive: store.countPersonArchive('owner'),
    })
  }
}
const elapsedMs = Date.now() - started
const person = store.readPerson('owner')
const archiveRows = store.readPersonArchive('owner', 2000)
const activeRecall = engine.recall({ sessionId: 's1', query: '第 4500 轮', limit: 4 })
const archiveRecall = engine.recall({ sessionId: 's1', query: '第 3000 轮', limit: 4 })
const earlyRecall = engine.recall({ sessionId: 's1', query: '第 500 轮', limit: 8 })

console.log(
  JSON.stringify(
    {
      turns: TURNS,
      elapsedMs,
      modelCalls: boundaryCalls + inductionCalls,
      boundaryCalls,
      inductionCalls,
      budget: { maxTokens: config.maxInjectTokens, maxChars: config.maxInjectChars },
      samples,
      final: {
        activeEpisodes: person.episodes.length,
        archivedEpisodes: store.countPersonArchive('owner'),
        archiveRowsRead: archiveRows.length,
        contextTokens: estimateTokens(engine.context({ sessionId: 's1', query: '事件' })),
        activeRecallFound: activeRecall.episodes.some((episode) => episode.summary.includes('4500')),
        archiveRecallFound: archiveRecall.episodes.some((episode) => episode.summary.includes('3000')),
        keyEpisodeOnActive: person.episodes.some((episode) => episode.summary.includes('4500')),
        earlyKeyOnActive: person.episodes.some((episode) => episode.summary.includes('500 轮')),
        earlyKeyRecallFound: earlyRecall.episodes.some((episode) => episode.summary.includes('500 轮')),
      },
    },
    null,
    2,
  ),
)
fs.rmSync(dir, { recursive: true, force: true })
