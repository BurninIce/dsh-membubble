import assert from 'node:assert/strict'
import test from 'node:test'

import { extractTurn, lastUserText, textOfContent } from '../lib/turn.js'

const user = (text, seq, source = { kind: 'user' }) => ({
  type: 'user/message',
  seq,
  time: 1,
  surfaceOp: 'append',
  data: { id: `u-${seq}`, role: 'user', content: [{ type: 'text', text }], source },
})
const assistant = (text, seq) => ({
  type: 'assistant/message',
  seq,
  time: 1,
  surfaceOp: 'append',
  data: {
    turn: 1,
    step: 0,
    message: {
      id: `a-${seq}`,
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '内部推理' },
        { type: 'text', text },
        { type: 'tool-call', id: 'c1', name: 'x', arguments: '{}' },
      ],
      source: { kind: 'model', provider: 'p', model: 'm' },
    },
    stream: [],
  },
})

test('textOfContent keeps text blocks and drops reasoning/tool calls', () => {
  assert.equal(
    textOfContent([
      { type: 'reasoning', text: '不该出现' },
      { type: 'text', text: '第一段' },
      { type: 'text', text: '第二段' },
      { type: 'tool-call', id: 'c', name: 'x', arguments: '{}' },
    ]),
    '第一段\n第二段',
  )
  assert.equal(textOfContent(undefined), '')
})

test('extractTurn reads only the requested turn and only human input', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    user('上一轮的人话', 2),
    assistant('上一轮的回答', 3),
    { type: 'turn/end', seq: 4, time: 1, data: { turn: 1 } },
    { type: 'turn/start', seq: 5, time: 1, data: { turn: 2 } },
    user('注入的记忆块', 6, { kind: 'dsh-membubble' }),
    user('这一轮的人话', 7),
    assistant('这一轮的回答', 8),
    { type: 'turn/end', seq: 9, time: 1, data: { turn: 2 } },
  ]
  const turn = extractTurn(events, 2)
  assert.equal(turn.userText, '这一轮的人话')
  assert.equal(turn.assistantText, '这一轮的回答')
  assert.equal(turn.userMessages, 1)
  assert.equal(turn.assistantMessages, 1)
})

test('extractTurn joins multiple human messages in one turn', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    user('第一句', 2),
    user('第二句', 3),
    assistant('回答', 4),
    { type: 'turn/end', seq: 5, time: 1, data: { turn: 1 } },
  ]
  const turn = extractTurn(events, 1)
  assert.equal(turn.userText, '第一句\n第二句')
  assert.equal(turn.userMessages, 2)
})

test('extractTurn returns empty fields for an unknown turn', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    user('一句话', 2),
    assistant('回答', 3),
    { type: 'turn/end', seq: 4, time: 1, data: { turn: 1 } },
  ]
  assert.deepEqual(extractTurn(events, 9), {
    userText: '',
    assistantText: '',
    userMessages: 0,
    assistantMessages: 0,
  })
})

test('lastUserText skips injected contexts and finds the latest human message', () => {
  const events = [
    user('第一条人话', 1),
    user('注入内容', 2, { kind: 'goal' }),
    user('第二条人话', 3),
    assistant('回答', 4),
  ]
  assert.equal(lastUserText(events), '第二条人话')
  assert.equal(lastUserText([]), '')
})
