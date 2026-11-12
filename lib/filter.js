/**
 * Group-message noise filter.
 *
 * A large group's focus window is easily filled by "草", "666", "哈哈哈" or a
 * single emoji. Those messages must not earn focus points or trigger a group
 * atmosphere summary. The filter is deliberately conservative: only messages
 * with no recoverable content are dropped, and a direct mention always passes.
 *
 * Private chat does not use this filter: there is only one speaker and every
 * line is the conversation.
 */

const PLACEHOLDER_RE = /\[图片[^\]]*\]|\[表情\]|\[链接[^\]]*\]/gu
const AT_RE = /@[^\s@，。！？,.!?]{1,16}(?=[\s，。！？,.!?]|$)/gu

const FILLERS = new Set([
  '草', '6', '66', '666', '6666', '233', '2333', '23333',
  '1', '11', '111', '嗯', '嗯嗯', '哦', '噢', '啊', '哈', '呵', '嘿',
  '好', '行', '可', '在', '在吗', '有人吗', '早', '早安', '晚安',
  '睡了', '收到', '好的', 'ok', 'okay', '打卡', '签到',
])
const LAUGH = new Set(['哈', '呵', '嘿', '嘻', '2', '3', '6'])

/** Keep only letters and numbers; drop placeholders, mentions, punctuation, emoji and marks. */
export function coreText(text) {
  let value = String(text ?? '')
  value = value.replace(PLACEHOLDER_RE, '').replace(AT_RE, '')
  let out = ''
  for (const char of value) {
    if (/\s/u.test(char)) continue
    if (/[\p{P}\p{Z}\p{C}\p{S}\p{M}]/u.test(char)) continue
    out += char
  }
  return out
}

/**
 * @param {string} text
 * @param {{ direct?: boolean }} [options]
 * @returns {boolean} true when the message carries no content worth remembering
 */
export function isNoise(text, options = {}) {
  if (options.direct === true) return false
  const core = coreText(text)
  if (!core) return true
  const lower = core.toLowerCase()
  if (core.length <= 4 && FILLERS.has(lower)) return true
  if (core.length >= 2 && new Set(core).size === 1) return true
  if (core.length >= 2 && [...core].every((char) => LAUGH.has(char))) return true
  return false
}
