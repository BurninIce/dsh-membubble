/**
 * Extract one settled turn from a session event log.
 *
 * DSH stores user/assistant messages as surface events but only assistant
 * messages carry a turn number; the turn boundary is the `turn/start` /
 * `turn/end` pair. Reading backwards from the `turn/end` we are reacting to
 * gives exactly that turn's messages without touching the projection machinery.
 */

/** Join the text blocks of a message; reasoning and tool calls are ignored. */
export function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * @param {readonly any[]} events session snapshot, oldest first
 * @param {number} turn
 * @returns {{ userText: string, assistantText: string, userMessages: number, assistantMessages: number }}
 */
export function extractTurn(events, turn) {
  const empty = { userText: '', assistantText: '', userMessages: 0, assistantMessages: 0 }
  if (!Array.isArray(events) || !events.length) return empty
  const collected = []
  let foundStart = false
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'turn/start') {
      if (event.data?.turn === turn) {
        foundStart = true
        break
      }
      // The snapshot ends inside a different turn: the requested one is not
      // present, so returning whatever is here would attribute the wrong text.
      return empty
    }
    collected.push(event)
  }
  if (!foundStart) return empty
  collected.reverse()
  const users = []
  const assistants = []
  let assistantMessages = 0
  for (const event of collected) {
    if (event.type === 'user/message') {
      // Only real human input counts. `agent.inject()` contexts (memory blocks,
      // file notices, goal rounds) also arrive as user messages and must not be
      // mistaken for something the speaker said.
      if (event.data?.source?.kind !== 'user') continue
      const text = textOfContent(event.data.content)
      if (text) users.push(text)
    } else if (event.type === 'assistant/message') {
      assistantMessages += 1
      const text = textOfContent(event.data?.message?.content)
      if (text) assistants.push(text)
    }
  }
  return {
    userText: users.join('\n').trim(),
    assistantText: assistants.join('\n').trim(),
    userMessages: users.length,
    assistantMessages,
  }
}

/**
 * Last human utterance in a session, used as the retrieval query.
 * @param {readonly any[]} events
 */
export function lastUserText(events) {
  if (!Array.isArray(events)) return ''
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    const text = textOfContent(event.data.content)
    if (text) return text
  }
  return ''
}
