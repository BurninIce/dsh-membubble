/**
 * Prompts for the three model judgments in dsh-membubble.
 *
 * They are deliberately narrow: one judgment per call, JSON only, and every
 * rule that protects the data model (attribution, relative time words,完整列表)
 * is repeated in the prompt *and* enforced again in code where possible.
 */

import { cardDigest } from './model.js'
import { shortStamp, truncate } from './util.js'

const JSON_ONLY = '只输出一个 JSON 对象，不要代码块、不要任何解释。'

/** @param {string} value */
function nameOf(value, fallback) {
  return String(value ?? '').trim() || fallback
}

/**
 * @param {{ agentName?: string, speakerName?: string,
 *   rounds: Array<{ at: number, user: string, assistant: string }>,
 *   known: string, force?: boolean }} input
 */
export function boundaryPrompt(input) {
  const agent = nameOf(input.agentName, '角色')
  const speaker = nameOf(input.speakerName, '对方')
  const rounds = input.rounds
    .map((round) => {
      const lines = [`[${shortStamp(round.at)}] ${speaker}：${truncate(round.user, 300)}`]
      if (round.assistant) lines.push(`[${shortStamp(round.at)}] ${agent}：${truncate(round.assistant, 300)}`)
      return lines.join('\n')
    })
    .join('\n')
  const lines = []
  lines.push(`你是「${agent}」的记忆判官。${agent}正在和「${speaker}」聊天。`)
  lines.push('下面是一段尚未闭合的话题缓冲（按时间顺序，可能多轮）：')
  lines.push(rounds)
  lines.push('')
  if (input.known) {
    lines.push('已知记忆（只用于判断这段是不是旧事重提，不要重复记录）：')
    lines.push(input.known)
    lines.push('')
  }
  if (input.force) {
    lines.push('注意：缓冲已达上限，**必须**给出 close 决策（不得输出 continue），只判断整段是否值得记。')
  }
  lines.push('判断**当前话题是否已经结束**：')
  lines.push('- 这件事还没发生完/没讲完，下一句大概率还在同一件事里 → {"action":"continue"}')
  lines.push('- 这件事已经发生完或讲完（一顿饭吃完了、事情聊清楚了、话题转向了新的一件事）→ 给出 close 决策')
  lines.push('close 时判断整段话题**整体**是否值得记入记忆：')
  lines.push(
    `值得记：${speaker}明确说出重要的身份/偏好/事实、${agent}自我披露、情感互动、关系转折、冲突、承诺，` +
      '以及**真的共同做了一件具体的事**（一起吃饭、一起出门、做了一个约定、兑现了之前说好的事），' +
      '哪怕对话本身平淡，importance 至少给 2。',
  )
  lines.push(
    '不值得记：纯寒暄、日常客套、无新信息的问答（「哈哈哈」「嗯」这类纯应和），' +
      '以及只是嘴上聊到某件事、并没有真的一起做——这些给 {"action":"close","worth":false}。',
  )
  lines.push('importance：3=重要（影响关系/核心事实），2=有信息量，1=勉强值得；不确定时宁低勿高。')
  lines.push(
    '值得记时，episode 覆盖**整个话题**（一次完整经历记一条，不要拆成多轮）：' +
      '{"action":"close","worth":true,"episode":{"summary":"整个话题的一句话叙事摘要（30 字内）",' +
      '"scene":"对话发生的地点","emotion":"角色当时的情绪","importance":1到3的整数,"tags":["标签"]}}',
  )
  lines.push('summary 不要写相对时间词（今天/昨天/刚才/上周），时间由系统另行记录。')
  lines.push(JSON_ONLY)
  return lines.join('\n')
}

/**
 * @param {{ agentName?: string, speakerName?: string,
 *   episodes: Array<Record<string, any>>, person: Record<string, any> }} input
 */
export function inductPrompt(input) {
  const agent = nameOf(input.agentName, '角色')
  const speaker = nameOf(input.speakerName, '对方')
  const episodes = input.episodes
    .map(
      (episode) =>
        `#${episode.id} [${shortStamp(episode.at)}] 对方：${truncate(episode.userText || episode.summary, 220)}` +
        (episode.assistantText ? `\n    ${agent}：${truncate(episode.assistantText, 220)}` : ''),
    )
    .join('\n')
  const lines = []
  lines.push(`你在为「${agent}」归档关于「${speaker}」的人物记忆卡。`)
  lines.push('共同经历（每条形如「#编号 时间 对方说… 角色说…」）：')
  lines.push(episodes || '（没有新事件）')
  lines.push('')
  lines.push('当前记忆卡（上一轮归档的结果）：')
  lines.push(cardDigest(input.person))
  lines.push('')
  lines.push('归类铁律（主语决定类别）：')
  lines.push(`- facts：只记**${speaker}本人说过**的关于自己的事实（身份/偏好/经历）。${agent}说的话、关于${agent}的事，一律不进 facts。`)
  lines.push(`- impressions：只记${speaker}表现的**稳定特质**（从言行归纳的性格/习惯）。`)
  lines.push(`- selfDisclosure：只记**${agent}自己透露过**的关于自己的事（能力/想法/过去/偏好）。只记几天后仍然成立的事，不记当前场景与地点。`)
  lines.push('- reflections：只写一两句对你们关系的观察，没有就留空数组。')
  lines.push(
    `- 人称铁律：指代对方一律用「你」，禁止写「用户」「对方」「该用户」；指${agent}自己时写「${agent}」或「我」。`,
  )
  lines.push('- 不要写相对时间词（今天/昨天/前天/刚才/上周）。')
  lines.push('- 每条 text 不超过 40 字；每个数组最多 6 条。')
  lines.push(
    '**返回完整的更新后列表**：这次没有重提、也不再成立的旧条目会被移除；仍在的旧条目请原样保留。',
  )
  lines.push('- style：一句话概括对方跨轮稳定的说话/行为风格（如「话多，爱反问」「潜水，偏温和」），只写风格，不写具体说了什么；没有把握就留空串。')
  lines.push('')
  lines.push('数值（0-100 的整数；这是你根据共同经历给出的目标值，系统会限制单次变化幅度）：')
  lines.push('- affection：好感；trust：信任；familiarity：熟悉度（随互动次数与深度增长）。')
  lines.push('')
  lines.push(
    '只输出这个 JSON：{"affection":0,"trust":0,"familiarity":0,"style":"",' +
      '"impressions":["..."],"facts":["..."],"selfDisclosure":["..."],"reflections":["..."]}',
  )
  return lines.join('\n')
}

/**
 * @param {{ agentName?: string, speakerName?: string,
 *   interactionCount: number, importantEpisodes: number, episodeCount: number,
 *   hasFacts: boolean, hasImpressions: boolean, hasStyle: boolean }} input
 */
export function promotionPrompt(input) {
  const agent = nameOf(input.agentName, '角色')
  const speaker = nameOf(input.speakerName, '对方')
  const lines = []
  lines.push(`你是「${agent}」的记忆判官。判断群友「${speaker}」是否已经从「群里一个模糊的名字」，`)
  lines.push(`变成让${agent}印象深刻、值得单独建立人物画像的人。`)
  lines.push('信号：')
  lines.push(`- 已记录的互动事件：${input.episodeCount} 条（其中重要事件 ${input.importantEpisodes} 条）`)
  lines.push(`- 互动轮数：${input.interactionCount}`)
  lines.push(`- 是否已沉淀关于他的事实：${input.hasFacts ? '有' : '无'}`)
  lines.push(`- 是否已形成对他的印象：${input.hasImpressions ? '有' : '无'}`)
  lines.push(`- 是否能说出他的稳定风格：${input.hasStyle ? '有' : '无'}`)
  lines.push('')
  lines.push('只有当你们有过**多次实质性互动**，且已有具体事实或稳定印象时才判 true；')
  lines.push('只是打过招呼、聊过一两句天气，判 false。')
  lines.push('只输出：{"promote":true 或 false,"why":"一句话理由"}')
  return lines.join('\n')
}

/**
 * @param {{ agentName?: string, groupName?: string,
 *   members: Array<{ name: string }>, buffer: Array<{ at: number, text: string }>,
 *   current: { vibe?: string, scene?: string } }} input
 */
export function groupPrompt(input) {
  const agent = nameOf(input.agentName, '角色')
  const group = nameOf(input.groupName, '这个群')
  const transcript = input.buffer
    .map((row) => `[${shortStamp(row.at)}] ${truncate(row.text, 300)}`)
    .join('\n')
  const lines = []
  lines.push(`你在维护「${agent}」对群聊「${group}」的群体层认知（群聊气泡）。`)
  lines.push('最近这段对话：')
  lines.push(transcript || '（最近没有新的对话）')
  lines.push('')
  lines.push(`当前群体气泡：氛围「${input.current.vibe || '暂无'}」，场景「${input.current.scene || '暂无'}」`)
  lines.push('')
  lines.push('请更新群体层。铁律：')
  lines.push('- 只写**群体氛围**与**最近发生过什么**，写成无人称措辞（如「有人争论过一个技术方案，最后不了了之」）。')
  lines.push('- **不要写任何人的名字、昵称或账号**，不要写「某某说……」这种归因到个人的话。')
  lines.push('- 不要写任何具体言论的转述；具体发言属于个人层记忆，不属于群体层。')
  lines.push('- events 最多 4 条，每条 40 字内；只写这段对话里真实发生的事。')
  lines.push('')
  lines.push('只输出：{"vibe":"一句话群体氛围","scene":"一句话群聊场景","events":[{"summary":"无人称事件","importance":1到3}]}')
  return lines.join('\n')
}

export const PROMOTION_WHY_MAX = 60
