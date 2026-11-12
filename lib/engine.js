/**
 * The bubble memory engine.
 *
 * One public entry point per operation; all DSH specifics (sessions, events,
 * prompt sections) live in `index.js`. The engine owns:
 * - topic buffering and boundary judgment,
 * - episode commit + periodic card induction,
 * - the group bubble summary and member promotion,
 * - the per-agent injection text.
 *
 * Model calls are injected as `complete(...)`, so the whole lifecycle is
 * testable with a scripted fake.
 */

import { resolveConfig } from './config.js'
import { budgetReport } from './budget.js'
import { isNoise } from './filter.js'
import {
  focusRole,
  isDirect,
  noteFocusImportance,
  pruneMembers,
  recordFocus,
} from './focus.js'
import {
  addEpisode,
  addGroupBuffer,
  addPending,
  applyGroupUpdate,
  applyInduction,
  cardDigest,
  episodesForInduction,
  forgetOld,
  MAX_GROUP_BUFFER,
  MAX_PENDING,
  promotePerson,
  relationshipFor,
  touchMember,
  trimEpisodes,
} from './model.js'
import { boundaryPrompt, groupPrompt, inductPrompt, promotionPrompt } from './prompts.js'
import { retrieve } from './retrieve.js'
import { renderContext } from './render.js'
import { clamp, oneLine, parseJsonObject, shortStamp, truncate } from './util.js'

const GREETING_RE = /您好|早上好|晚上好|中午好|午安|好久不见|早安|晚安|你好|再见|拜拜|在吗|嗨|哈喽|哈哈|呵呵|嗯|哦|啊|呀/gu
const ONLY_MOOD_RE = /^[嗯哦噢好行嗨哈呵！!？?。.\s]*$/u
const SPEAKER_PREFIX_RE = /^\s*([^\s：:]{1,16})[：:]\s*/u

/** True for turns that carry no new information worth judging. */
export function isGreeting(text) {
  const value = oneLine(text)
  if (!value || ONLY_MOOD_RE.test(value)) return true
  return value.replace(GREETING_RE, '').length < 4
}

export class BubbleEngine {
  /**
   * @param {{
   *   store: import('./store.js').BubbleStore,
   *   config: Record<string, any>,
   *   complete?: null | ((input: { system: string, user: string, maxTokens: number,
   *     temperature: number, timeoutMs: number }) => Promise<string>),
   *   logger?: { info: Function, warn: Function, debug?: Function },
   *   now?: () => number,
   * }} options
   */
  constructor(options) {
    this.store = options.store
    this.config = options.config ?? resolveConfig({})
    this.complete = options.complete ?? null
    this.log = options.logger ?? { info() {}, warn() {} }
    this.now = options.now ?? Date.now
    this.queue = Promise.resolve()
    /** @type {Map<string, { id: string, name: string }>} sessionId → last resolved speaker */
    this.speakerHints = new Map()
  }

  // ---------------------------------------------------------------- bindings

  /** @param {string} sessionId */
  bindingFor(sessionId) {
    const bindings = this.store.readBindings()
    return bindings.sessions?.[String(sessionId)] ?? null
  }

  /**
   * Bind one DSH session to a personal or group bubble.
   * @param {string} sessionId
   * @param {{ mode?: 'personal'|'group', groupId?: string, groupName?: string,
   *   speakerId?: string, speakerName?: string }} patch
   */
  bind(sessionId, patch = {}) {
    const bindings = this.store.readBindings()
    const previous = bindings.sessions[String(sessionId)] ?? {}
    const next = {
      mode: patch.mode === 'group' ? 'group' : patch.mode === 'personal' ? 'personal' : previous.mode ?? 'personal',
      groupId: String(patch.groupId ?? previous.groupId ?? '').trim(),
      groupName: String(patch.groupName ?? previous.groupName ?? '').trim(),
      speakerId: String(patch.speakerId ?? previous.speakerId ?? '').trim(),
      speakerName: String(patch.speakerName ?? previous.speakerName ?? '').trim(),
      boundAt: this.now(),
    }
    if (next.mode === 'group' && !next.groupId) next.groupId = 'default'
    bindings.sessions[String(sessionId)] = next
    this.store.writeBindings(bindings)
    return next
  }

  /** @param {string} sessionId */
  unbind(sessionId) {
    const bindings = this.store.readBindings()
    const existed = Boolean(bindings.sessions?.[String(sessionId)])
    if (existed) {
      delete bindings.sessions[String(sessionId)]
      this.store.writeBindings(bindings)
    }
    this.forgetSession(sessionId)
    return existed
  }

  /** Drop the per-session speaker hint when the session leaves. */
  forgetSession(sessionId) {
    this.speakerHints.delete(String(sessionId))
  }

  /**
   * Resolve the current speaker for a session.
   *
   * Explicit binding wins; then an optional `Name：` prefix in the message (the
   * transport convention for multi-speaker chats); then the configured default.
   *
   * @param {string} sessionId
   * @param {string} text
   */
  resolveSpeaker(sessionId, text) {
    const binding = this.bindingFor(sessionId)
    if (binding?.speakerId) {
      return {
        id: binding.speakerId,
        name: binding.speakerName || binding.speakerId,
        text: String(text ?? ''),
        binding,
        fromPrefix: false,
      }
    }
    if (this.config.speakerPrefix) {
      const match = SPEAKER_PREFIX_RE.exec(String(text ?? ''))
      const name = match?.[1]?.trim() ?? ''
      if (name && name !== this.config.agentName) {
        return {
          id: `name:${name}`,
          name,
          text: String(text).slice(match[0].length),
          binding,
          fromPrefix: true,
        }
      }
    }
    return {
      id: this.config.defaultSpeakerId,
      name: this.config.defaultSpeakerName,
      text: String(text ?? ''),
      binding,
      fromPrefix: false,
    }
  }

  /**
   * Remember the speaker of the latest message without observing it yet.
   *
   * Injection is evaluated before `turn/end`, so a multi-speaker session must
   * update its hint when the user message arrives; otherwise the next prompt
   * would still describe the previous speaker.
   *
   * @param {string} sessionId
   * @param {string} text
   */
  noteSpeaker(sessionId, text) {
    const resolved = this.resolveSpeaker(sessionId, text)
    this.speakerHints.set(String(sessionId), { id: resolved.id, name: resolved.name })
    return resolved
  }

  /**
   * Speaker for reads (context/recall/status): explicit > binding > last hint > default.
   * @param {string} sessionId
   * @param {{ id?: string, name?: string }} [explicit]
   */
  speakerFor(sessionId, explicit) {
    if (explicit?.id) return { id: explicit.id, name: explicit.name ?? explicit.id }
    const binding = this.bindingFor(sessionId)
    if (binding?.speakerId) return { id: binding.speakerId, name: binding.speakerName || binding.speakerId }
    const hint = this.speakerHints.get(String(sessionId))
    if (hint) return hint
    return { id: this.config.defaultSpeakerId, name: this.config.defaultSpeakerName }
  }

  // --------------------------------------------------------------- observing

  /**
   * Observe one conversational turn. Serialized through a single queue so two
   * sessions cannot race the same person document.
   *
   * @param {{ sessionId: string, userText: string, assistantText: string,
   *   at?: number, speaker?: { id: string, name: string } }} input
   */
  observeTurn(input) {
    if (!this.config.enabled) return Promise.resolve({ ok: false, reason: '插件已禁用' })
    const at = input.at ?? this.now()
    const userText = truncate(oneLine(input.userText), 2000)
    const assistantText = truncate(oneLine(input.assistantText), 2000)
    if (!userText) return Promise.resolve({ ok: false, reason: '空消息' })
    const run = this.queue.then(async () => {
      try {
        return await this.observeNow({ ...input, at, userText, assistantText })
      } catch (error) {
        this.log.warn(`记忆观察失败：${String(error?.message ?? error)}`)
        return { ok: false, reason: String(error?.message ?? error) }
      }
    })
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Synchronous body of {@link observeTurn}; public for tests. */
  async observeNow(input) {
    const { sessionId, at, userText, assistantText } = input
    const resolved = input.speaker
      ? { id: input.speaker.id, name: input.speaker.name, text: userText, binding: this.bindingFor(sessionId), fromPrefix: false }
      : this.resolveSpeaker(sessionId, userText)
    const binding = resolved.binding
    const mode = binding?.mode === 'group' ? 'group' : 'personal'
    const speakerId = String(resolved.id || this.config.defaultSpeakerId)
    const speakerName = resolved.name || speakerId
    this.speakerHints.set(String(sessionId), { id: speakerId, name: speakerName })
    const direct = isDirect(userText, this.config.agentName, input.direct === true)

    let group = null
    let role = 'personal'
    if (mode === 'group' && this.config.groupEnabled) {
      group = this.store.ensureGroup(binding?.groupId || 'default', binding?.groupName || '群聊', at)
      // Noise never reaches the focus board, the group atmosphere, or a person.
      if (!direct && isNoise(userText)) {
        this.store.writeGroup(group)
        return { ok: true, action: 'ignored-noise', speaker: { id: speakerId, name: speakerName } }
      }
      const dropped = addGroupBuffer(
        group,
        `${speakerName}：${truncate(resolved.text || userText, 300)}\n${this.config.agentName || '角色'}：${truncate(assistantText, 300)}`,
        at,
      )
      if (dropped.length) this.log.debug?.(`群缓冲溢出，丢弃 ${dropped.length} 条旧摘要`)
      group.messagesSinceUpdate = (group.messagesSinceUpdate || 0) + 1
      role = recordFocus(
        group,
        {
          uid: speakerId,
          name: speakerName,
          importance: direct ? this.config.focusDirectImportance : 1,
          at,
        },
        this.config,
        at,
      )
      if (direct && role !== 'active') role = 'active'
      if (role) {
        const existing = this.store.readPerson(speakerId)
        touchMember(group, {
          id: speakerId,
          name: speakerName,
          promoted: existing?.promoted ?? false,
          style: existing?.style ?? '',
        })
      }
      this.store.writeGroup(group)
      if (role === '') {
        await this.maybeUpdateGroup(group, at)
        this.store.writeGroup(group)
        return {
          ok: true,
          action: 'ignored-focus',
          speaker: { id: speakerId, name: speakerName },
          role,
        }
      }
    }

    const focusActive = mode !== 'group' || role !== 'buffer'
    const person = this.store.ensurePerson(speakerId, speakerName, at, {
      promoted: mode === 'personal' || speakerId === this.config.defaultSpeakerId,
    })
    if (group) touchMember(group, { id: speakerId, name: speakerName, promoted: person.promoted })
    addPending(person, { at, user: resolved.text || userText, assistant: assistantText })
    this.store.writePerson(person)
    if (group) this.store.writeGroup(group)

    let action = 'buffered'
    let episode = null
    if (this.complete && (this.config.boundaryCheck || person.pending.length >= this.config.bufferCap)) {
      const force = person.pending.length >= this.config.bufferCap
      if (!force && isGreeting(userText)) {
        // Greetings go into the buffer without spending a model call; the cap
        // still forces a close later.
      } else {
        const judged = await this.judgeBoundary(person, speakerName, force)
        if (judged?.action === 'close') {
          if (judged.worth && judged.episode) {
            const rounds = person.pending.length
            episode = this.commitEpisode(person, judged.episode, speakerName, at)
            action = 'closed'
            await this.afterEpisode(person, group, speakerId, speakerName, at, rounds, focusActive)
          } else {
            person.pending = []
            action = 'discarded'
          }
          this.store.writePerson(person)
          if (group) this.store.writeGroup(group)
        }
      }
    }

    if (group && this.config.groupEnabled) {
      await this.maybeUpdateGroup(group, at)
      // Keep a promoted member's fuzzy style current even when no induction ran.
      if (person.promoted && person.style) {
        touchMember(group, { id: speakerId, name: speakerName, style: person.style, promoted: true })
      }
      pruneMembers(group, this.config, at)
      this.store.writeGroup(group)
    }

    if (person.pending.length > MAX_PENDING) person.pending = person.pending.slice(-MAX_PENDING)
    return { ok: true, action, speaker: { id: speakerId, name: speakerName }, episode, role }
  }

  /**
   * Run the group summary when enough valid messages accumulated and the
   * minimum interval has passed. A full buffer forces an attempt so messages are
   * not silently dropped before a summary.
   */
  async maybeUpdateGroup(group, at) {
    if (!this.complete || !this.config.groupEnabled || !group.buffer.length) return null
    const dueCount = group.messagesSinceUpdate >= this.config.groupUpdateEvery
    const full = group.buffer.length >= MAX_GROUP_BUFFER
    if (!full && group.buffer.length < 2) return null
    if (!dueCount && !full) return null
    const sinceAttempt = at - (group.lastGroupAttemptAt || 0)
    if (!full && group.lastGroupAttemptAt && sinceAttempt < this.config.groupMinIntervalSec * 1000) return null
    group.lastGroupAttemptAt = at
    return this.updateGroup(group, at)
  }

  /**
   * Judge whether the buffered topic has ended.
   * @returns {Promise<null | { action: 'continue' }
   *   | { action: 'close', worth: boolean, episode?: Record<string, any> }>}
   */
  async judgeBoundary(person, speakerName, force) {
    if (!this.complete) return null
    const prompt = boundaryPrompt({
      agentName: this.config.agentName,
      speakerName,
      rounds: person.pending,
      known: truncate(cardDigest(person), 800),
      force,
    })
    try {
      const raw = await this.callModel(prompt, this.config.boundaryMaxTokens)
      const parsed = parseJsonObject(raw)
      if (!parsed || typeof parsed !== 'object') return null
      if (parsed.action === 'continue') return { action: 'continue' }
      if (parsed.action !== 'close') return null
      const episode = normalizeEpisode(parsed.episode)
      if (parsed.worth === true && episode) return { action: 'close', worth: true, episode }
      return { action: 'close', worth: false }
    } catch (error) {
      this.log.warn(`话题边界判定失败（保留缓冲）：${String(error?.message ?? error)}`)
      return null
    }
  }

  /** Commit one closed topic as an episode and count the interaction. */
  commitEpisode(person, episode, speakerName, at) {
    const rounds = person.pending
    const userText = truncate(rounds.map((round) => round.user).join('\n'), 800)
    const assistantText = truncate(rounds.map((round) => round.assistant).join('\n'), 800)
    const stored = addEpisode(
      person,
      {
        ...episode,
        at,
        userText,
        assistantText,
        source: 'judge',
      },
      at,
    )
    person.pending = []
    person.interactionCount += 1
    const forgotten = forgetOld(person, { days: this.config.forgetDays, now: at })
    this.archivePersonEpisodes(person, forgotten.removed)
    const overflow = trimEpisodes(person)
    this.archivePersonEpisodes(person, overflow)
    this.log.info(`记忆事件 #${stored.id}（${speakerName}）：${stored.summary}`)
    return stored
  }

  /**
   * Append evicted episodes to the archive. If the archive cannot be written,
   * put them back into the active list rather than losing the only copy.
   */
  archivePersonEpisodes(person, episodes) {
    if (!Array.isArray(episodes) || episodes.length === 0) return true
    try {
      this.store.archivePersonEpisodes(person.id, episodes)
      return true
    } catch (error) {
      this.log.warn(`事件归档失败，保留在活跃列表：${String(error?.message ?? error)}`)
      person.episodes = [...episodes, ...person.episodes]
      return false
    }
  }

  /** Group-event counterpart of {@link archivePersonEpisodes}. */
  archiveGroupEvents(group, events) {
    if (!Array.isArray(events) || events.length === 0) return true
    try {
      this.store.archiveGroupEvents(group.id, events)
      return true
    } catch (error) {
      this.log.warn(`群事件归档失败，保留在活跃列表：${String(error?.message ?? error)}`)
      group.events = [...events, ...group.events]
      return false
    }
  }

  /** Induction / promotion / group maintenance triggered by one commit. */
  async afterEpisode(person, group, speakerId, speakerName, at, rounds = 2, active = true) {
    const latest = person.episodes[person.episodes.length - 1]
    if (group && latest) {
      // A closed topic's importance outranks the per-message default and keeps
      // a genuinely important speaker on the focus board.
      noteFocusImportance(group, speakerId, latest.importance, this.config, at, rounds)
    }
    const since = person.interactionCount - (person.lastInductionCount || 0)
    // Buffer members still record events; they only defer card induction and
    // promotion, so a large group cannot fan out one induction per speaker.
    if (active && since >= this.config.inductEvery) {
      await this.induct(person, speakerName, at)
    }
    if (active && group && !person.promoted && this.config.promotionEnabled) {
      await this.maybePromote(person, group, speakerId, speakerName, at)
    }
    if (group && person.style) {
      touchMember(group, { id: speakerId, name: speakerName, style: person.style, promoted: person.promoted })
    }
  }

  /** Rebuild the inducted card from recent episodes. */
  async induct(person, speakerName, at) {
    if (!this.complete) return null
    const episodes = episodesForInduction(person, 20)
    if (!episodes.length) return null
    const prompt = inductPrompt({
      agentName: this.config.agentName,
      speakerName,
      episodes,
      person,
    })
    try {
      const raw = await this.callModel(prompt, this.config.inductMaxTokens)
      const parsed = parseJsonObject(raw)
      if (!parsed || typeof parsed !== 'object') return null
      const { record } = applyInduction(person, parsed, {
        at,
        episodeIds: episodes.map((episode) => episode.id),
      })
      person.relationship = relationshipFor(person.stats)
      this.log.info(
        `记忆卡已归纳（${speakerName}）：${record.before.affection}/${record.before.trust}/${record.before.familiarity} → ` +
          `${record.after.affection}/${record.after.trust}/${record.after.familiarity}`,
      )
      return record
    } catch (error) {
      this.log.warn(`记忆卡归纳失败：${String(error?.message ?? error)}`)
      return null
    }
  }

  /** Ask the judge whether an unpromoted group member deserves a person bubble. */
  async maybePromote(person, group, speakerId, speakerName, at) {
    if (!this.complete || person.promoted) return false
    if (person.episodes.length < this.config.promotionMinEpisodes) return false
    const important = person.episodes.filter((episode) => episode.importance >= 2).length
    const prompt = promotionPrompt({
      agentName: this.config.agentName,
      speakerName,
      interactionCount: person.interactionCount,
      importantEpisodes: important,
      episodeCount: person.episodes.length,
      hasFacts: (person.card.facts?.length ?? 0) > 0,
      hasImpressions: (person.card.impressions?.length ?? 0) > 0,
      hasStyle: Boolean(person.style),
    })
    try {
      const raw = await this.callModel(prompt, this.config.promotionMaxTokens)
      const parsed = parseJsonObject(raw)
      if (!parsed || parsed.promote !== true) return false
      promotePerson(person, at)
      touchMember(group, { id: speakerId, name: speakerName, promoted: true, style: person.style })
      this.log.info(`群友已晋升为人物气泡（${speakerName}）：${truncate(parsed.why, 60)}`)
      return true
    } catch (error) {
      this.log.warn(`晋升判定失败：${String(error?.message ?? error)}`)
      return false
    }
  }

  /** Refresh the group bubble after enough observed turns. */
  async updateGroup(group, at) {
    if (!this.complete || !group.buffer.length) return null
    const prompt = groupPrompt({
      agentName: this.config.agentName,
      groupName: group.name,
      members: Object.values(group.members ?? {}),
      buffer: group.buffer.slice(-this.config.groupSummaryTurns),
      current: { vibe: group.vibe, scene: group.scene },
    })
    try {
      const raw = await this.callModel(prompt, this.config.groupMaxTokens)
      const parsed = parseJsonObject(raw)
      if (!parsed || typeof parsed !== 'object') return null
      const memberNames = [
        ...new Set([
          ...Object.values(group.members ?? {}).map((member) => member.name),
          ...group.buffer
            .map((row) => String(row.text ?? '').split('\n')[0].split('：')[0].trim())
            .filter((name) => name && name !== this.config.agentName),
        ]),
      ]
      const result = applyGroupUpdate(group, parsed, { at, memberNames })
      if (!result.accepted) {
        this.log.warn(`群聊气泡输出为空，保留缓冲（${group.name}）`)
        return null
      }
      if (result.overflow?.length) {
        this.archiveGroupEvents(group, result.overflow)
      }
      pruneMembers(group, this.config, at)
      this.log.info(`群聊气泡已更新（${group.name}）：${truncate(result.vibe || result.scene, 50)}`)
      return result
    } catch (error) {
      this.log.warn(`群聊气泡更新失败：${String(error?.message ?? error)}`)
      return null
    }
  }

  // --------------------------------------------------------------- injection

  /**
   * The per-agent system text for the next model step.
   *
   * @param {{ sessionId: string, query?: string, now?: number }} input
   */
  context(input) {
    if (!this.config.enabled) return ''
    const now = input.now ?? this.now()
    const binding = this.bindingFor(input.sessionId)
    const mode = binding?.mode === 'group' ? 'group' : 'personal'
    const speaker = this.speakerFor(input.sessionId, input.speaker)
    const person = this.store.readPerson(speaker.id)
    const group = mode === 'group' && this.config.groupEnabled
      ? this.store.readGroup(binding?.groupId || 'default')
      : null
    const gated = Boolean(group && person && !person.promoted)
    const episodes =
      person && !gated ? retrieve(person, input.query ?? '', { now, limit: this.config.retrieveLimit }) : []
    return renderContext({
      person,
      group,
      binding,
      episodes,
      config: this.config,
      now,
    })
  }

  // ------------------------------------------------------------------ tools

  /**
   * @param {{ sessionId: string, speaker?: { id: string, name: string },
   *   query: string, limit?: number }} input
   */
  recall(input) {
    const now = this.now()
    const binding = this.bindingFor(input.sessionId)
    const speaker = this.speakerFor(input.sessionId, input.speaker)
    const person = this.store.readPerson(speaker.id)
    if (!person) return { gated: false, person: null, episodes: [] }
    const gated = binding?.mode === 'group' && !person.promoted
    const limit = clamp(input.limit ?? this.config.retrieveLimit, 1, 12)
    let episodes
    if (gated) {
      episodes = person.episodes.slice(-Math.min(limit, 3)).map((episode) => ({
        ...episode,
        summary: `（还不太熟，只记得）${episode.summary}`,
      }))
    } else {
      // Archived episodes remain searchable by an explicit recall, even though
      // only the active list is eligible for automatic injection.
      const archive = this.store.readPersonArchive(person.id, this.config.archiveRecallLimit)
      const byId = new Map()
      for (const episode of [...archive, ...person.episodes]) byId.set(episode.id, episode)
      const merged = [...byId.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
      episodes = retrieve({ ...person, episodes: merged }, input.query ?? '', { now, limit })
    }
    return { gated, person, episodes }
  }

  /**
   * Store a manual memory (a fact the agent was explicitly told to remember).
   * @param {{ sessionId: string, text: string, importance?: number, tags?: string[],
   *   speaker?: { id: string, name: string } }} input
   */
  remember(input) {
    const at = this.now()
    const text = truncate(oneLine(input.text), 120)
    if (!text) throw new Error('要记住的内容为空')
    const speaker = this.speakerFor(input.sessionId, input.speaker)
    const binding = this.bindingFor(input.sessionId)
    // An explicit remember must not bypass promotion: in a group, a person the
    // judge has not promoted stays gated, and the episode becomes promotion
    // material like any other.
    const promoted = binding?.mode !== 'group' || speaker.id === this.config.defaultSpeakerId
    const person = this.store.ensurePerson(speaker.id, speaker.name, at, { promoted })
    const episode = addEpisode(
      person,
      {
        summary: text,
        scene: '',
        emotion: '',
        importance: clamp(input.importance ?? 2, 1, 3),
        tags: input.tags ?? [],
        userText: '',
        assistantText: '',
        source: 'manual',
      },
      at,
    )
    const overflow = trimEpisodes(person)
    this.archivePersonEpisodes(person, overflow)
    this.store.writePerson(person)
    return { person, episode, promoted: person.promoted }
  }

  /**
   * Delete one episode from one person bubble.
   * @param {{ sessionId: string, episodeId: number, speaker?: { id: string } }} input
   */
  forget(input) {
    const speaker = this.speakerFor(input.sessionId, input.speaker)
    const person = this.store.readPerson(speaker.id)
    if (!person) return { removed: false, id: input.episodeId }
    const index = person.episodes.findIndex((episode) => episode.id === Number(input.episodeId))
    if (index < 0) return { removed: false, id: input.episodeId }
    person.episodes.splice(index, 1)
    person.updatedAt = this.now()
    this.store.writePerson(person)
    return { removed: true, id: input.episodeId }
  }

  /**
   * Manually promote the current speaker to a person bubble.
   * @param {string} sessionId
   * @param {{ id?: string, name?: string }} [speaker]
   */
  promoteNow(sessionId, speaker = {}) {
    const at = this.now()
    const binding = this.bindingFor(sessionId)
    const speakerId = speaker.id || binding?.speakerId || this.config.defaultSpeakerId
    const speakerName = speaker.name || binding?.speakerName || this.config.defaultSpeakerName
    const person = this.store.ensurePerson(speakerId, speakerName, at, { promoted: true })
    const changed = promotePerson(person, at)
    this.store.writePerson(person)
    if (binding?.mode === 'group' && binding.groupId) {
      const group = this.store.readGroup(binding.groupId)
      if (group) {
        touchMember(group, { id: speakerId, name: speakerName, promoted: true, style: person.style })
        this.store.writeGroup(group)
      }
    }
    return { changed, person }
  }

  /** @param {string} sessionId */
  status(sessionId) {
    const binding = this.bindingFor(sessionId)
    const speaker = this.speakerFor(sessionId)
    const person = this.store.readPerson(speaker.id)
    const group =
      binding?.mode === 'group' && this.config.groupEnabled
        ? this.store.readGroup(binding.groupId || 'default')
        : null
    const inject = budgetReport(this.context({ sessionId }), {
      maxChars: this.config.maxInjectChars,
      maxTokens: this.config.maxInjectTokens,
    })
    const role = group ? focusRole(group, speaker.id, this.config) : 'personal'
    return {
      binding,
      speakerId: speaker.id,
      speakerName: speaker.name,
      role,
      person: person
        ? {
            id: person.id,
            name: person.name,
            promoted: person.promoted,
            relationship: person.relationship,
            stats: person.stats,
            episodes: person.episodes.length,
            archiveEpisodes: this.store.countPersonArchive(person.id),
            pending: person.pending.length,
            facts: person.card.facts.length,
            impressions: person.card.impressions.length,
            style: person.style,
            lastAt: person.updatedAt,
          }
        : null,
      group: group
        ? {
            id: group.id,
            name: group.name,
            vibe: group.vibe,
            scene: group.scene,
            events: group.events.length,
            archiveEvents: this.store.countGroupArchive(group.id),
            members: Object.keys(group.members).length,
            buffer: group.buffer.length,
            focus: group.focus.length,
            messagesSinceUpdate: group.messagesSinceUpdate,
          }
        : null,
      inject,
      namespace: this.config.namespace,
    }
  }

  /** Human-readable status for `/membubble`. */
  summary(sessionId) {
    const status = this.status(sessionId)
    const lines = []
    if (status.binding) {
      lines.push(
        `当前绑定：${status.binding.mode === 'group' ? `群聊「${status.binding.groupName || status.binding.groupId}」` : '私聊'}｜说话人「${status.speakerName}」`,
      )
    } else {
      lines.push(`未绑定，按私聊处理；说话人「${status.speakerName}」。`)
    }
    if (status.group) {
      lines.push(
        `群聊气泡：${status.group.vibe || '暂无氛围'}（${status.group.events} 条事件 / ${status.group.members} 人 / 焦点 ${status.group.focus} 条 / 缓冲 ${status.group.buffer} 条）`,
      )
      if (status.group.archiveEvents) lines.push(`群事件归档：${status.group.archiveEvents} 条`)
    }
    if (status.person) {
      const p = status.person
      lines.push(
        `人物气泡：「${p.name}」${p.promoted ? '' : '（未晋升）'}｜${p.relationship}｜好感 ${Math.round(p.stats.affection)}｜信任 ${Math.round(p.stats.trust)}｜熟悉 ${Math.round(p.stats.familiarity)}`,
      )
      lines.push(`事件 ${p.episodes} 条，待闭合 ${p.pending} 轮，事实 ${p.facts} 条，印象 ${p.impressions} 条`)
      if (p.archiveEpisodes) lines.push(`事件归档：${p.archiveEpisodes} 条`)
      if (p.style) lines.push(`风格：${p.style}`)
      if (p.lastAt) lines.push(`最近互动：${shortStamp(p.lastAt)}`)
    } else {
      lines.push('人物气泡：还没有记忆。')
    }
    lines.push(
      `注入预算：约 ${status.inject.tokens} tokens / ${status.inject.chars} 字（上限 ${status.inject.maxTokens} tokens / ${status.inject.maxChars} 字）`,
    )
    return lines.join('\n')
  }

  // ------------------------------------------------------------------ private

  async callModel(prompt, maxTokens) {
    return this.complete({
      system: '你是一个严格的记忆判官，只输出 JSON。',
      user: prompt,
      maxTokens,
      temperature: this.config.temperature,
      timeoutMs: this.config.timeoutMs,
    })
  }
}

/** Normalize one episode object returned by the judge. */
function normalizeEpisode(raw) {
  if (!raw || typeof raw !== 'object') return null
  const summary = truncate(oneLine(raw.summary), 80)
  if (summary.length < 4) return null
  return {
    summary,
    scene: truncate(oneLine(raw.scene), 40),
    emotion: truncate(oneLine(raw.emotion), 40),
    importance: clamp(raw.importance ?? 1, 1, 3),
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((tag) => truncate(oneLine(tag), 20)).filter(Boolean).slice(0, 4)
      : [],
  }
}
