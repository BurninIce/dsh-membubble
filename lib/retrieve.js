/**
 * Lexical recall over one person's episodes.
 *
 * No embedding service is required: Chinese is tokenized into character bigrams,
 * Latin text into words, and scoring combines overlap, recency and importance.
 * The point is not semantic search — it is "did they talk about this before"
 * with a stable, inspectable, dependency-free score.
 */

import { daysBetween } from './util.js'

const MEMORY_INTENT = /记得|忘了|忘记|刚才|之前|以前|上次|说过|聊过|想起|回忆|还记得/u
const LATIN_RE = /[a-z0-9_]{2,}/gu
const CJK_RUN_RE = /[\u3400-\u9fff]+/gu
const STOP_BIGRAMS = new Set(['的时', '时候', '的是', '了一', '一个', '这个', '那个', '什么', '怎么'])

/** @param {string} text @returns {string[]} */
export function tokens(text) {
  const value = String(text ?? '').toLowerCase()
  const out = new Set()
  for (const match of value.matchAll(LATIN_RE)) out.add(match[0])
  for (const match of value.matchAll(CJK_RUN_RE)) {
    const run = match[0]
    if (run.length === 1) {
      out.add(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2)
      if (!STOP_BIGRAMS.has(bigram)) out.add(bigram)
    }
  }
  return [...out]
}

/** Asymmetric overlap: how much of the query the document covers. */
export function overlap(queryTokens, documentTokens) {
  if (!queryTokens.length || !documentTokens.length) return 0
  const doc = new Set(documentTokens)
  let hits = 0
  for (const token of queryTokens) if (doc.has(token)) hits += 1
  return hits / queryTokens.length
}

/** True when the text looks like a question about memory rather than a topic. */
export function memoryIntent(query) {
  return MEMORY_INTENT.test(String(query ?? ''))
}

/**
 * Score and select episodes for one query.
 *
 * @param {Record<string, any>} person
 * @param {string} query
 * @param {{ now?: number, limit?: number, minScore?: number }} [options]
 * @returns {Array<Record<string, any> & { score: number }>}
 */
export function retrieve(person, query, options = {}) {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? 4
  const minScore = options.minScore ?? 0.12
  const episodes = Array.isArray(person?.episodes) ? person.episodes : []
  if (!episodes.length) return []
  const intent = memoryIntent(query)
  const queryTokens = tokens(query)
  const noQuery = queryTokens.length === 0
  const scored = []
  for (const episode of episodes) {
    const docTokens = tokens(
      `${episode.summary} ${episode.userText} ${(episode.tags ?? []).join(' ')}`,
    )
    const lexical = overlap(queryTokens, docTokens)
    if (!noQuery && !intent && lexical === 0) continue
    const days = daysBetween(episode.at, now)
    const recency = Math.exp(-days / 30)
    const importance = ((episode.importance ?? 1) - 1) / 2
    let score
    if (noQuery) {
      // No topic at all: "what happened recently" — recency dominates, with
      // importance only nudging ties.
      score = recency * 0.95 + importance * 0.05
    } else if (intent) {
      score = lexical * 0.45 + recency * 0.45 + importance * 0.1
    } else {
      score = lexical * 0.55 + recency * 0.25 + importance * 0.2
    }
    if (!intent && !noQuery && score < minScore) continue
    scored.push({ ...episode, score, lexical, recency })
  }
  scored.sort((a, b) => b.score - a.score || b.at - a.at)
  return scored.slice(0, limit)
}

/**
 * Human-readable recall lines for prompt injection.
 * @param {Array<Record<string, any>>} episodes
 */
export function recallLines(episodes) {
  return episodes.map((episode) => {
    const date = new Date(episode.at)
    const stamp = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return `- [${stamp}] ${episode.summary}`
  })
}
