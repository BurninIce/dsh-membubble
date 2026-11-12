/**
 * Dependency-free helpers for dsh-membubble.
 *
 * Pure functions only, so the memory model, retrieval and rendering can be
 * unit-tested without a DSH process or a model.
 */

/** @param {string} text @param {number} max */
export function truncate(text, max) {
  const value = String(text ?? '').trim()
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

/** Collapse whitespace to one space (memory text is single-line by contract). */
export function oneLine(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim()
}

/** @param {unknown} value */
export function stringList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    const item = oneLine(raw)
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** First JSON object in model output; undefined when it does not parse. */
export function parseJsonObject(text) {
  const source = String(text ?? '').trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(source.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/** `MM-DD HH:MM` local stamp. */
export function shortStamp(ms) {
  const date = new Date(ms)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${m}-${d} ${hh}:${mm}`
}

/** Whole days from `then` to `now`, never negative. */
export function daysBetween(then, now) {
  return now <= then ? 0 : Math.floor((now - then) / 86_400_000)
}

/** Clamp a value into [lo, hi]; non-finite falls back to `lo`. */
export function clamp(value, lo, hi) {
  const n = Number(value)
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

/**
 * Deterministic short hash (cyrb53 variant) used only to disambiguate unsafe
 * ids after sanitizing, never as a security primitive.
 * @param {string} text
 */
export function shortHash(text) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).slice(0, 6)
}

/**
 * Filesystem-safe id with a collision-resistant suffix.
 * Unicode ids (numeric chat ids, names) survive as hex-free transliteration when
 * safe, otherwise only the hash remains — the mapping is kept inside the file.
 * @param {string} id
 */
export function safeId(id) {
  const raw = String(id ?? '').trim()
  if (!raw) return 'unknown'
  const sanitized = raw.replace(/[^0-9A-Za-z_-]/gu, '_').slice(0, 40)
  return `${sanitized || 'id'}_${shortHash(raw)}`
}

/** JSON clone for plain stored data. */
export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value))
}
