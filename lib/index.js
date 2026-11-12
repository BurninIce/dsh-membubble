/**
 * dsh-membubble — bubble-model memory for personal and group conversations.
 *
 * Layers:
 * - L0 group bubble: impersonal atmosphere/events plus fuzzy member styles,
 *   shown only to a session bound to that group;
 * - L1 person bubble: one person's episodes and inducted card, injected when
 *   that person is the current speaker;
 * - L2 full card: a promoted member (or the configured default speaker) gets
 *   the full person bubble; an unpromoted group member gets name + recency only.
 *
 * Turns are observed after they settle; one judge decides when a topic closes,
 * one induction rebuilds the card every N closed topics, and a promotion judge
 * decides when a group member deserves a person bubble. All model calls are
 * auxiliary and never block the conversation.
 */

import z from '@deepseek-ai/schemastery'
import { resolveConfig } from './config.js'
import { BubbleEngine } from './engine.js'
import { makeCompleter, routeFor } from './llm.js'
import { recallLines } from './retrieve.js'
import { BubbleStore, resolveDataDir } from './store.js'
import { buildTools } from './tools.js'
import { extractTurn, lastUserText, textOfContent } from './turn.js'

export const name = 'membubble'
export const inject = ['systemPrompt', 'tools', 'commands', 'llm']

export const Config = z.object({
  enabled: z.boolean().default(true).description('是否启用记忆观察与注入'),
  dataDir: z.string().default('').description('数据根目录，留空为 $DSH_HOME/membubble'),
  namespace: z.string().default('default').description('角色/部署命名空间，避免不同角色共享记忆'),
  applyToSubagents: z.boolean().default(false).description('是否也观察/注入子 agent 会话'),
  agentName: z.string().default('').description('角色名，用于记忆判官 prompt'),
  defaultSpeakerId: z.string().default('owner').description('未绑定时默认说话人 id'),
  defaultSpeakerName: z.string().default('你').description('未绑定时默认说话人显示名'),
  speakerPrefix: z.boolean().default(false).description('是否识别「名字：」前缀作为说话人'),
  provider: z.string().default('').description('判官模型 provider；留空沿用会话当前路由'),
  model: z.string().default('').description('判官模型 model；与 provider 成对'),
  temperature: z.number().min(0).max(2).default(0.2),
  timeoutMs: z.number().step(1).min(5000).max(180000).default(60000),
  boundaryMaxTokens: z.number().step(1).min(100).max(2000).default(400),
  inductMaxTokens: z.number().step(1).min(200).max(4000).default(900),
  groupMaxTokens: z.number().step(1).min(100).max(2000).default(400),
  promotionMaxTokens: z.number().step(1).min(50).max(1000).default(160),
  bufferCap: z.number().step(1).min(2).max(32).default(8).description('话题缓冲达到该轮数强制闭合'),
  boundaryCheck: z.boolean().default(true).description('每轮是否调用判官判断话题是否结束'),
  inductEvery: z.number().step(1).min(1).max(50).default(5).description('每 N 条事件重归纳记忆卡'),
  forgetDays: z.number().step(1).min(1).max(3650).default(30).description('importance=1 的事件保留天数'),
  retrieveLimit: z.number().step(1).min(0).max(12).default(4),
  maxInjectChars: z.number().step(1).min(200).max(8000).default(1600),
  maxInjectTokens: z.number().step(1).min(200).max(8000).default(1400).description('注入文本的保守 token 上限'),
  maxGroupMembers: z.number().step(1).min(1).max(30).default(8),
  groupEnabled: z.boolean().default(true),
  groupUpdateEvery: z.number().step(1).min(1).max(200).default(20).description('每 N 条有效群消息更新群聊气泡'),
  groupMinIntervalSec: z.number().step(1).min(0).max(3600).default(180).description('两次群氛围归纳的最小间隔'),
  groupSummaryTurns: z.number().step(1).min(5).max(60).default(20).description('群氛围归纳读最近多少条'),
  focusWindow: z.number().step(1).min(10).max(200).default(60).description('对话焦点窗口条数'),
  focusTtlSec: z.number().step(1).min(600).max(604800).default(21600).description('焦点条目有效期（秒）'),
  focusActive: z.number().step(1).min(1).max(20).default(5).description('进入个人记忆管线的活跃人数'),
  focusBuffer: z.number().step(1).min(0).max(20).default(5).description('缓冲人数（只进群氛围）'),
  focusTurnWeight: z.number().min(0).max(5).default(0.5),
  focusImportantMult: z.number().step(1).min(1).max(20).default(5),
  focusDirectImportance: z.number().step(1).min(1).max(3).default(3).description('@/点名消息的焦点权重'),
  memberTtlSec: z.number().step(1).min(86400).max(31536000).default(2592000).description('未晋升成员的保留时间（秒）'),
  maxGroupMembersStored: z.number().step(1).min(10).max(2000).default(200).description('群成员记录上限'),
  archiveRecallLimit: z.number().step(1).min(100).max(20000).default(2000).description('归档检索最多读多少条'),
  promotionEnabled: z.boolean().default(true),
  promotionMinEpisodes: z.number().step(1).min(1).max(50).default(3),
})

/** Section order: right after ootd's daily block, before the persona suffix. */
const SECTION_ORDER = 8100
const SECTION_NAME = 'membubble:memory'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {z.infer<typeof Config>} rawConfig
 */
export function apply(ctx, rawConfig) {
  const log = ctx.logger('membubble')
  const config = resolveConfig(rawConfig)
  const store = new BubbleStore(resolveDataDir(config.dataDir, config.namespace), {
    warn: (message) => log.warn(message),
  })
  /** @type {{ provider: string, model: string } | null} */
  let lastRoute =
    config.provider && config.model ? { provider: config.provider, model: config.model } : null
  const engine = new BubbleEngine({
    store,
    config,
    complete: makeCompleter(ctx, () => lastRoute),
    logger: { info: (m) => log.info(m), warn: (m) => log.warn(m) },
  })

  for (const tool of buildTools({ engine })) ctx.tools.register(tool)

  /** @type {Map<string, any>} sessionId → agent */
  const agents = new Map()
  /** @type {Map<any, () => void>} agent → section disposer */
  const sectionOff = new Map()
  /** @type {Map<string, string>} sessionId → last human text (retrieval query) */
  const lastUser = new Map()

  const rememberRoute = (agent) => {
    const route = routeFor(config, agent?.session)
    if (route) lastRoute = route
  }

  ctx.provide('membubble', {
    bind: (sessionId, patch) => engine.bind(sessionId, patch),
    unbind: (sessionId) => engine.unbind(sessionId),
    /** @param {{ sessionId: string, userText: string, assistantText: string }} input */
    observeTurn: (input) => engine.observeTurn(input),
    /** @param {{ sessionId: string, query: string, limit?: number }} input */
    recall: (input) => engine.recall(input),
    /** @param {{ sessionId: string, text: string, importance?: number }} input */
    remember: (input) => engine.remember(input),
    /** @param {{ sessionId: string, query?: string }} input */
    context: (input) => engine.context(input),
    status: (sessionId) => engine.status(sessionId),
    summary: (sessionId) => engine.summary(sessionId),
    promote: (sessionId) => engine.promoteNow(sessionId),
  })

  ctx.commands.register({
    name: 'membubble',
    description: '查看/绑定/检索气泡记忆：/membubble、bind、speaker、recall、promote、forget',
    input: {
      hint: '留空看状态；bind group <群号> [群名] / bind personal / speaker <id> <名字> / recall <词> / promote / forget <id>',
    },
    handler(invocation) {
      const sessionId = invocation.agent?.session?.id
      if (!sessionId) return { kind: 'error', text: '无法确定当前会话' }
      const input = String(invocation.rawInput ?? '').trim()
      if (!input) return { kind: 'success', text: engine.summary(sessionId) }
      const [rawCommand, ...rest] = input.split(/\s+/u)
      const command = rawCommand.toLowerCase()
      if (command === 'bind') {
        const mode = (rest[0] ?? '').toLowerCase()
        if (mode === 'personal' || mode === '私聊') {
          const name = rest.slice(1).join(' ').trim()
          const binding = engine.bind(sessionId, {
            mode: 'personal',
            groupId: '',
            groupName: '',
            speakerId: config.defaultSpeakerId,
            speakerName: name || config.defaultSpeakerName,
          })
          return { kind: 'success', text: `已绑定为私聊，说话人「${binding.speakerName}」。` }
        }
        if (mode === 'group' || mode === '群聊') {
          const groupId = rest[1]
          if (!groupId) return { kind: 'error', text: '用法：/membubble bind group <群号> [群名]' }
          const groupName = rest.slice(2).join(' ').trim() || groupId
          const binding = engine.bind(sessionId, { mode: 'group', groupId, groupName })
          return {
            kind: 'success',
            text: `已绑定到群聊「${binding.groupName}」。可用 /membubble speaker <id> <名字> 指定当前说话人。`,
          }
        }
        return { kind: 'error', text: '用法：/membubble bind personal [名字] 或 /membubble bind group <群号> [群名]' }
      }
      if (command === 'speaker' || command === '说话人') {
        const id = rest[0]
        const name = rest.slice(1).join(' ').trim() || id
        if (!id) return { kind: 'error', text: '用法：/membubble speaker <id> <名字>' }
        const binding = engine.bind(sessionId, { speakerId: id, speakerName: name })
        return { kind: 'success', text: `当前说话人已设为「${binding.speakerName}」（${id}）。` }
      }
      if (command === 'recall' || command === '检索') {
        const query = rest.join(' ').trim()
        if (!query) return { kind: 'error', text: '用法：/membubble recall <关键词>' }
        const result = engine.recall({ sessionId, query })
        if (!result.episodes.length) return { kind: 'success', text: '没有检索到相关记忆。' }
        const lines = [`关于「${result.person?.name ?? '对方'}」：`]
        if (result.gated) lines.push('（还不太熟，只记得最近这些）')
        lines.push(...recallLines(result.episodes))
        return { kind: 'success', text: lines.join('\n') }
      }
      if (command === 'promote' || command === '晋升') {
        const result = engine.promoteNow(sessionId, rest[0] ? { id: rest[0], name: rest.slice(1).join(' ') || rest[0] } : {})
        return {
          kind: 'success',
          text: result.changed
            ? `已把「${result.person.name}」晋升为人物气泡。`
            : `「${result.person.name}」已经是人物气泡了。`,
        }
      }
      if (command === 'forget' || command === '忘记') {
        const id = Number.parseInt(rest[0] ?? '', 10)
        if (!Number.isFinite(id)) return { kind: 'error', text: '用法：/membubble forget <事件编号>' }
        const result = engine.forget({ sessionId, episodeId: id })
        return result.removed
          ? { kind: 'success', text: `已删除记忆事件 #${id}。` }
          : { kind: 'error', text: `没有找到记忆事件 #${id}。` }
      }
      if (command === 'help' || command === '帮助') {
        return {
          kind: 'success',
          text: [
            '/membubble — 查看状态',
            '/membubble bind personal [名字] — 绑定为私聊',
            '/membubble bind group <群号> [群名] — 绑定到群聊',
            '/membubble speaker <id> <名字> — 指定当前说话人',
            '/membubble recall <关键词> — 检索与当前说话人的记忆',
            '/membubble promote — 手动晋升当前说话人',
            '/membubble forget <编号> — 删除一条记忆事件',
          ].join('\n'),
        }
      }
      return { kind: 'error', text: '未知子命令，发 /membubble help 查看用法。' }
    },
  })

  ctx.on('agent/created', (payload) => {
    const agent = payload.agent
    if (!config.applyToSubagents && agent.session?.header?.origin === 'subagent') return
    const sessionId = agent.session.id
    agents.set(sessionId, agent)
    rememberRoute(agent)
    try {
      const restored = lastUserText(agent.session.snapshotEvents())
      lastUser.set(sessionId, restored)
      if (restored) engine.noteSpeaker(sessionId, restored)
    } catch {
      // A restored session may still be settling; the first user message fills it.
    }
    const off = agent.ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      interpolate: false,
      text: () => {
        try {
          return engine.context({ sessionId, query: lastUser.get(sessionId) ?? '' })
        } catch (error) {
          log.warn(`气泡记忆注入失败：${String(error?.message ?? error)}`)
          return ''
        }
      },
    })
    sectionOff.set(agent, off)
  })

  ctx.on('agent/disposed', (payload) => {
    const agent = payload.agent
    agents.delete(agent.session.id)
    lastUser.delete(agent.session.id)
    engine.forgetSession(agent.session.id)
    const off = sectionOff.get(agent)
    if (off) off()
    sectionOff.delete(agent)
  })

  ctx.on('session/event', (session, event) => {
    if (event.type === 'user/message') {
      if (event.data?.source?.kind !== 'user') return
      const text = textOfContent(event.data.content)
      if (text) {
        lastUser.set(session.id, text)
        // Inject for this very turn: prompt assembly runs before turn/end, so
        // the speaker hint must be updated when the human message arrives.
        engine.noteSpeaker(session.id, text)
      }
      return
    }
    if (event.type !== 'turn/end') return
    const agent = agents.get(session.id)
    if (!agent) return
    rememberRoute(agent)
    let turn
    try {
      turn = extractTurn(session.snapshotEvents(), event.data.turn)
    } catch (error) {
      log.warn(`读取会话轮次失败：${String(error?.message ?? error)}`)
      return
    }
    if (!turn.userText || !turn.assistantText) return
    void engine
      .observeTurn({
        sessionId: session.id,
        userText: turn.userText,
        assistantText: turn.assistantText,
        at: Number(event.time) || Date.now(),
      })
      .then((result) => {
        if (result?.action === 'closed') log.debug?.(`本轮记忆已闭合：${result.episode?.summary ?? ''}`)
      })
      .catch((error) => log.warn(`记忆观察失败：${String(error?.message ?? error)}`))
  })

  ctx.effect(() => () => {
    for (const off of sectionOff.values()) off()
    sectionOff.clear()
    agents.clear()
    lastUser.clear()
  })
}
