import assert from 'node:assert/strict'
import test from 'node:test'

import { coreText, isNoise } from '../lib/filter.js'

test('noise filter drops placeholders, fillers, repeats and laughter', () => {
  for (const text of ['草', '6666', '23333', '哈哈哈哈', '？？？', '😭😭', '   ', '[图片]', '好的', '在吗？', '啊啊啊啊']) {
    assert.equal(isNoise(text), true, `should be noise: ${text}`)
  }
})

test('noise filter keeps short messages that carry content', () => {
  for (const text of [
    '我觉得这个方案不行',
    '明天几点集合',
    '哈哈哈这个bug太蠢了',
    '@小明 你看下日志',
    '在吗，问个事',
    '好家伙，真敢写',
    '12306 又崩了',
    '😭😭这个报错怎么修',
  ]) {
    assert.equal(isNoise(text), false, `should pass: ${text}`)
  }
})

test('direct messages always pass, even when they look like filler', () => {
  assert.equal(isNoise('草', { direct: true }), false)
  assert.equal(isNoise('？', { direct: true }), false)
  assert.equal(isNoise('@角色', { direct: true }), false)
})

test('coreText strips placeholders, mentions and symbols but keeps content', () => {
  assert.equal(coreText('@小明 [图片] 你看下日志！'), '你看下日志')
  assert.equal(coreText('😭😭这个报错怎么修'), '这个报错怎么修')
})
