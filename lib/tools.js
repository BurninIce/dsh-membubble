/**
 * Model-facing tools for dsh-membubble.
 *
 * `membubble_recall` is the explicit lookup (the automatic injection already
 * carries the card + recent recall), `membubble_remember` stores a fact the user
 * asked to keep, and `membubble_status` lets the agent inspect what it knows
 * without dumping another person's data.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { shortStamp } from './util.js'

/**
 * @param {{ engine: import('./engine.js').BubbleEngine }} deps
 */
export function buildTools({ engine }) {
  const recall = defineTool({
    name: 'membubble_recall',
    description:
      '主动检索你与当前说话人的旧记忆（按语义关键词与时间）。当用户问「你还记得…」「之前说过…」，' +
      '或你需要确认某件旧事时使用；不要用它打探别人的隐私，也不要凭空编造记忆。',
    parameters: {
      query: { type: 'string', required: true, description: '要检索的关键词或问句，例如「咖啡」「上次说的旅行」。' },
      limit: { type: 'integer', description: '最多返回几条，1-12，默认 4。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          gated: { type: 'boolean', required: true },
          personName: { type: 'string', required: true },
          relationship: { type: 'string', required: true },
          episodes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'integer', required: true },
                at: { type: 'number', required: true },
                summary: { type: 'string', required: true },
                importance: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (!value.episodes.length) {
          return [{ type: 'text', text: `关于「${value.personName}」没有检索到相关记忆。` }]
        }
        const lines = value.episodes.map(
          (episode) => `- #${episode.id} [${shortStamp(episode.at)}] ${episode.summary}`,
        )
        return [
          {
            type: 'text',
            text: `${value.gated ? '（还不太熟，只记得最近这些）\n' : ''}关于「${value.personName}」（${value.relationship}）：\n${lines.join('\n')}`,
          },
        ]
      },
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session?.id
      if (!sessionId) throw new Error('membubble_recall 需要会话上下文')
      const result = engine.recall({ sessionId, query: args.query, limit: args.limit })
      return {
        gated: result.gated,
        personName: result.person?.name ?? '对方',
        relationship: result.person?.relationship ?? '陌生',
        episodes: result.episodes.map((episode) => ({
          id: episode.id,
          at: episode.at,
          summary: episode.summary,
          importance: episode.importance,
        })),
      }
    },
  })

  const remember = defineTool({
    name: 'membubble_remember',
    description:
      '把一件值得长期记住的事写进你与当前说话人的记忆（例如对方明确要求「记住这个」，或一条以后会用到的事实）。' +
      '日常寒暄、临时状态、别人的隐私不要写。一次只记一件事，summary 一句话讲清发生了什么。' +
      '群聊里尚未晋升的成员，这条记录只作为晋升材料，不会立刻进入人物画像。',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: '要记住的事，一句话、30 字内，不要写相对时间词（今天/刚才）。',
      },
      importance: { type: 'integer', description: '1-3，默认 2；影响关系或核心事实用 3。' },
      tags: {
        type: 'array',
        description: '可选标签，最多 4 个。',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          episodeId: { type: 'integer', required: true },
          summary: { type: 'string', required: true },
          total: { type: 'integer', required: true },
          promoted: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            `已记住：${value.summary}（#${value.episodeId}，共 ${value.total} 条记忆）` +
            (value.promoted ? '' : '；该成员尚未晋升，这条只作为晋升材料'),
        },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = exec.agent?.session?.id
      if (!sessionId) throw new Error('membubble_remember 需要会话上下文')
      const result = engine.remember({
        sessionId,
        text: args.text,
        importance: args.importance,
        tags: args.tags,
      })
      return {
        ok: true,
        episodeId: result.episode.id,
        summary: result.episode.summary,
        total: result.person.episodes.length,
        promoted: result.promoted,
      }
    },
  })

  const status = defineTool({
    name: 'membubble_status',
    description:
      '查看当前会话的记忆状态：绑定的是私聊还是群聊、说话人是谁、关系数值、记住了多少条事件。' +
      '用户问「你记得我多少」或你想确认记忆是否正常时可用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          speakerName: { type: 'string', required: true },
          relationship: { type: 'string', required: true },
          affection: { type: 'number', required: true },
          trust: { type: 'number', required: true },
          familiarity: { type: 'number', required: true },
          episodes: { type: 'integer', required: true },
          pending: { type: 'integer', required: true },
          promoted: { type: 'boolean', required: true },
          groupVibe: { type: 'string', required: true },
          injectTokens: { type: 'integer', required: true },
          archiveEpisodes: { type: 'integer', required: true },
          focus: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text:
            `${value.mode === 'group' ? `群聊（${value.groupVibe || '暂无氛围'}）` : '私聊'}｜` +
            `说话人「${value.speakerName}」｜${value.relationship}｜好感 ${Math.round(value.affection)}、信任 ${Math.round(value.trust)}、熟悉 ${Math.round(value.familiarity)}｜` +
            `事件 ${value.episodes} 条，待闭合 ${value.pending} 轮${value.promoted ? '' : '，尚未晋升为人物气泡'}｜` +
            `注入约 ${value.injectTokens} tokens` +
            (value.archiveEpisodes ? `｜归档 ${value.archiveEpisodes} 条` : '') +
            (value.focus ? `｜焦点 ${value.focus}` : ''),
        },
      ],
    },
    async execute(_args, exec) {
      const sessionId = exec.agent?.session?.id
      if (!sessionId) throw new Error('membubble_status 需要会话上下文')
      const value = engine.status(sessionId)
      const person = value.person
      return {
        mode: value.binding?.mode === 'group' ? 'group' : 'personal',
        speakerName: value.speakerName,
        relationship: person?.relationship ?? '陌生',
        affection: person?.stats.affection ?? 30,
        trust: person?.stats.trust ?? 30,
        familiarity: person?.stats.familiarity ?? 0,
        episodes: person?.episodes ?? 0,
        pending: person?.pending ?? 0,
        promoted: person?.promoted ?? false,
        groupVibe: value.group?.vibe ?? '',
        injectTokens: value.inject.tokens,
        archiveEpisodes: person?.archiveEpisodes ?? 0,
        focus: value.role === 'personal' ? '' : value.role,
      }
    },
  })

  return [recall, remember, status]
}
