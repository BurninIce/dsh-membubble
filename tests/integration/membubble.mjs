/**
 * Integration harness for dsh-membubble.
 *
 * Mounts the real plugin on a real Cordis context with fake DSH services, then
 * drives it as DSH does: user/turn events → judge → person bubble → promotion
 * → scoped section → tools/commands.
 *
 * Run from the repository root (see tests/integration/README.md):
 *
 *   node --import ./tests/integration/register-dsh-packages.mjs ./tests/integration/membubble.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'membubble-home-'))
process.env.DSH_HOME = home

const { Context } = await import('@deepseek-ai/cordis')
const membubble = await import('../../lib/index.js')

const ctx = new Context()
const sections = []
const tools = new Map()
const commands = new Map()
const prompts = []

ctx.provide('systemPrompt', {
  section(options) {
    sections.push(options)
    return () => {}
  },
})
ctx.provide('tools', {
  register(tool) {
    tools.set(tool.name, tool)
    return () => {}
  },
})
ctx.provide('commands', {
  register(command) {
    commands.set(command.name, command)
    return () => {}
  },
})
ctx.provide('llm', {
  async prepareCall(config) {
    return {
      config,
      async *stream(options) {
        const prompt = options.messages[0].content[0].text
        prompts.push(prompt)
        let answer = '{}'
        if (prompt.includes('判断**当前话题是否已经结束**')) {
          answer = JSON.stringify({
            action: 'close',
            worth: true,
            episode: {
              summary: prompt.includes('手冲') ? '他聊起自己最近在学手冲咖啡' : '他聊起家里养的猫',
              scene: '线上聊天',
              emotion: '平静',
              importance: 2,
              tags: ['咖啡'],
            },
          })
        } else if (prompt.includes('归档关于')) {
          const cat = prompt.includes('阿杰') || prompt.includes('猫')
          answer = JSON.stringify({
            affection: 46,
            trust: 42,
            familiarity: 12,
            style: cat ? '温和，话少' : '话多，爱反问',
            facts: [cat ? '家里养了一只猫' : '最近在学手冲咖啡'],
            impressions: [cat ? '偏安静' : '说话直接'],
            selfDisclosure: ['她会做红茶'],
            reflections: [],
          })
        } else if (prompt.includes('群体层')) {
          answer = JSON.stringify({
            vibe: '小林很活跃，偏技术向',
            scene: '在群里聊咖啡',
            events: [{ summary: '小林分享了一家咖啡店', importance: 2 }],
          })
        } else if (prompt.includes('群友')) {
          answer = JSON.stringify({ promote: true, why: '聊过多次，有稳定印象' })
        }
        yield { type: 'text-delta', index: 0, text: answer }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
  },
})

ctx.plugin(
  { name: membubble.name, inject: membubble.inject, apply: membubble.apply },
  {
    dataDir: path.join(home, 'data'),
    namespace: 'demo',
    agentName: '角色',
    defaultSpeakerId: 'owner',
    defaultSpeakerName: '阿川',
    provider: 'mock',
    model: 'mock-1',
    inductEvery: 1,
    groupUpdateEvery: 1,
    promotionMinEpisodes: 1,
  },
)

for (let i = 0; i < 100 && tools.size === 0; i += 1) await new Promise((r) => setTimeout(r, 20))
assert.equal(tools.size, 3, 'three membubble tools registered')
assert.ok(commands.has('membubble'), 'membubble command registered')

function makeSession(id) {
  const log = []
  return {
    log,
    session: {
      id,
      header: { version: 4, id, createdAt: Date.now(), isSeeded: false },
      snapshotEvents: () => log,
    },
  }
}

async function pushTurn(holder, turn, userText, assistantText) {
  const base = holder.log.length + 1
  holder.log.push(
    { type: 'turn/start', seq: base, time: Date.now(), data: { turn } },
    {
      type: 'user/message',
      seq: base + 1,
      time: Date.now(),
      surfaceOp: 'append',
      data: {
        id: `m-${turn}`,
        role: 'user',
        content: [{ type: 'text', text: userText }],
        source: { kind: 'user' },
      },
    },
    {
      type: 'assistant/message',
      seq: base + 2,
      time: Date.now(),
      surfaceOp: 'append',
      data: {
        turn,
        step: 0,
        message: {
          id: `a-${turn}`,
          role: 'assistant',
          content: [{ type: 'text', text: assistantText }],
          source: { kind: 'model', provider: 'mock', model: 'mock-1' },
        },
        stream: [],
      },
    },
    { type: 'turn/end', seq: base + 3, time: Date.now(), data: { turn } },
  )
  for (const event of holder.log.slice(-4)) ctx.emit(null, 'session/event', holder.session, event)
  await new Promise((r) => setTimeout(r, 150))
}

// --- personal session -------------------------------------------------------
const personal = makeSession('personal-1')
const agentCtx = ctx.extend()
const agent = { session: personal.session, ctx: agentCtx, status: 'idle' }
ctx.emit('agent/created', { agent, source: 'fresh' })
for (let i = 0; i < 100 && sections.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20))
assert.equal(sections.length, 1)
assert.equal(sections[0].name, 'membubble:memory')

await pushTurn(personal, 1, '我在学手冲咖啡', '哦？说说看。')
const service = ctx.get('membubble')
const personalStatus = service.status('personal-1')
assert.equal(personalStatus.person.promoted, true)
assert.equal(personalStatus.person.episodes, 1)
assert.equal(personalStatus.person.facts, 1)

let blocks = sections[0].text()
assert.match(blocks, /【人物气泡】你正在和「阿川」说话/)
assert.match(blocks, /最近在学手冲咖啡/)

// --- group session ----------------------------------------------------------
const group = makeSession('group-1')
service.bind('group-1', {
  mode: 'group',
  groupId: 'g1',
  groupName: '测试群',
  speakerId: 'u1',
  speakerName: '小林',
})
const groupCtx = ctx.extend()
const groupAgent = { session: group.session, ctx: groupCtx, status: 'idle' }
ctx.emit('agent/created', { agent: groupAgent, source: 'fresh' })
for (let i = 0; i < 100 && sections.length < 2; i += 1) await new Promise((r) => setTimeout(r, 20))

await pushTurn(group, 1, '今天去喝了手冲', '哪家？')
await pushTurn(group, 2, '公司楼下新开的', '味道如何？')
const groupStatus = service.status('group-1')
assert.equal(groupStatus.group.members, 1)
assert.equal(groupStatus.person.promoted, true)
assert.equal(groupStatus.person.episodes >= 2, true)

blocks = sections[1].text()
assert.match(blocks, /【群聊气泡】群「测试群」/)
assert.match(blocks, /【人物气泡】关于「小林」/)
assert.doesNotMatch(blocks, /小林很活跃/)

// --- tools and command ------------------------------------------------------
const recalled = await tools.get('membubble_recall').execute({ query: '咖啡' }, { agent: groupAgent })
assert.equal(recalled.episodes.length >= 1, true)
assert.doesNotMatch(recalled.episodes[0].summary, /养了一只猫/)

const saved = await tools.get('membubble_remember').execute(
  { text: '他下个月要搬去杭州', importance: 3 },
  { agent: groupAgent },
)
assert.equal(saved.ok, true)
assert.equal(saved.episodeId >= 1, true)

const statusTool = await tools.get('membubble_status').execute({}, { agent: groupAgent })
assert.equal(statusTool.mode, 'group')
assert.equal(statusTool.promoted, true)

const command = await commands.get('membubble').handler({
  agent: groupAgent,
  rawInput: '',
  attachments: [],
  signal: new AbortController().signal,
})
assert.equal(command.kind, 'success')
assert.match(command.text, /群聊气泡/)

fs.rmSync(home, { recursive: true, force: true })
console.log(`membubble integration OK: tools=3 command=1 prompts=${prompts.length}`)
process.exit(0)
