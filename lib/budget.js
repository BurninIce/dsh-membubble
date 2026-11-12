/**
 * A small, deterministic token budget for injected memory text.
 *
 * dsh does not expose a tokenizer to a system-prompt provider, so the plugin
 * uses a conservative estimate:
 *   CJK characters      1.6 tokens each
 *   everything else     ~4 characters per token
 * The estimate is intentionally pessimistic. The hard limit is enforced by
 * truncation, not by trusting the model to keep output short.
 */

const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/gu

/** @param {string} text @returns {number} conservative token estimate */
export function estimateTokens(text) {
  const value = String(text ?? '')
  if (!value) return 0
  const cjk = (value.match(CJK_RE) ?? []).length
  const other = value.length - cjk
  return Math.ceil(cjk * 1.6 + other / 4)
}

/** @param {string} text @param {{ maxChars?: number, maxTokens?: number }} limits */
export function fitsBudget(text, limits) {
  const value = String(text ?? '')
  if (limits.maxChars && value.length > limits.maxChars) return false
  if (limits.maxTokens && estimateTokens(value) > limits.maxTokens) return false
  return true
}

/**
 * Truncate to both limits, preferring the largest prefix that fits.
 * @param {string} text
 * @param {{ maxChars?: number, maxTokens?: number }} limits
 */
export function truncateToBudget(text, limits) {
  const value = String(text ?? '')
  if (fitsBudget(value, limits)) return value
  const maxChars = Math.min(value.length, limits.maxChars || value.length)
  let lo = 0
  let hi = maxChars
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = `${value.slice(0, mid)}…`
    if (fitsBudget(candidate, limits)) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? `${value.slice(0, lo)}…` : ''
}

/** Human-readable budget report for status. */
export function budgetReport(text, limits) {
  return {
    chars: String(text ?? '').length,
    tokens: estimateTokens(text),
    maxChars: limits.maxChars ?? 0,
    maxTokens: limits.maxTokens ?? 0,
  }
}
