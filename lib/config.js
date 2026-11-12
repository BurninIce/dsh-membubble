/**
 * Configuration defaults and validation for dsh-membubble.
 *
 * The plugin is intentionally conservative by default: it watches turns, keeps
 * topics open until the judge closes them, and only injects what the current
 * speaker is entitled to see.
 */

import { clamp, truncate } from './util.js'

export function resolveConfig(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: input.enabled !== false,
    dataDir: String(input.dataDir ?? '').trim(),
    namespace: truncate(input.namespace ?? 'default', 60) || 'default',
    applyToSubagents: input.applyToSubagents === true,
    agentName: truncate(input.agentName ?? '', 40),
    defaultSpeakerId: truncate(input.defaultSpeakerId ?? 'owner', 80) || 'owner',
    defaultSpeakerName: truncate(input.defaultSpeakerName ?? '你', 40) || '你',
    speakerPrefix: input.speakerPrefix === true,
    provider: truncate(input.provider ?? '', 80),
    model: truncate(input.model ?? '', 80),
    temperature: clampNumber(input.temperature, 0, 2, 0.2),
    timeoutMs: clampInt(input.timeoutMs, 5_000, 180_000, 60_000),
    boundaryMaxTokens: clampInt(input.boundaryMaxTokens, 100, 2000, 400),
    inductMaxTokens: clampInt(input.inductMaxTokens, 200, 4000, 900),
    groupMaxTokens: clampInt(input.groupMaxTokens, 100, 2000, 400),
    promotionMaxTokens: clampInt(input.promotionMaxTokens, 50, 1000, 160),
    bufferCap: clampInt(input.bufferCap, 2, 32, 8),
    boundaryCheck: input.boundaryCheck !== false,
    inductEvery: clampInt(input.inductEvery, 1, 50, 5),
    forgetDays: clampInt(input.forgetDays, 1, 3650, 30),
    retrieveLimit: clampInt(input.retrieveLimit, 0, 12, 4),
    maxInjectChars: clampInt(input.maxInjectChars, 200, 8000, 1600),
    maxInjectTokens: clampInt(input.maxInjectTokens, 200, 8000, 1400),
    maxGroupMembers: clampInt(input.maxGroupMembers, 1, 30, 8),
    groupEnabled: input.groupEnabled !== false,
    groupUpdateEvery: clampInt(input.groupUpdateEvery, 1, 200, 20),
    groupMinIntervalSec: clampInt(input.groupMinIntervalSec, 0, 3600, 180),
    groupSummaryTurns: clampInt(input.groupSummaryTurns, 5, 60, 20),
    focusWindow: clampInt(input.focusWindow, 10, 200, 60),
    focusTtlSec: clampInt(input.focusTtlSec, 600, 7 * 86_400, 6 * 3600),
    focusActive: clampInt(input.focusActive, 1, 20, 5),
    focusBuffer: clampInt(input.focusBuffer, 0, 20, 5),
    focusTurnWeight: clampNumber(input.focusTurnWeight, 0, 5, 0.5),
    focusImportantMult: clampInt(input.focusImportantMult, 1, 20, 5),
    focusDirectImportance: clampInt(input.focusDirectImportance, 1, 3, 3),
    memberTtlSec: clampInt(input.memberTtlSec, 86_400, 365 * 86_400, 30 * 86_400),
    maxGroupMembersStored: clampInt(input.maxGroupMembersStored, 10, 2000, 200),
    archiveRecallLimit: clampInt(input.archiveRecallLimit, 100, 20_000, 2000),
    promotionEnabled: input.promotionEnabled !== false,
    promotionMinEpisodes: clampInt(input.promotionMinEpisodes, 1, 50, 3),
  }
}

function clampInt(value, lo, hi, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

function clampNumber(value, lo, hi, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}
