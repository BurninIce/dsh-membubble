import assert from 'node:assert/strict'
import test from 'node:test'

import { budgetReport, estimateTokens, fitsBudget, truncateToBudget } from '../lib/budget.js'

test('token estimate is monotonic and charges CJK more than ASCII', () => {
  assert.equal(estimateTokens(''), 0)
  const ascii = estimateTokens('hello world')
  const chinese = estimateTokens('你好世界')
  assert.ok(chinese > ascii)
  assert.ok(estimateTokens('你好世界') > estimateTokens('你好'))
})

test('budget truncation respects both char and token limits', () => {
  const text = '记忆'.repeat(500)
  const limits = { maxChars: 300, maxTokens: 200 }
  const out = truncateToBudget(text, limits)
  assert.ok(out.length <= 300)
  assert.ok(estimateTokens(out) <= 200)
  assert.ok(out.endsWith('…'))
})

test('fitsBudget and budgetReport agree with the estimate', () => {
  const text = '你好世界'
  assert.equal(fitsBudget(text, { maxChars: 100, maxTokens: 100 }), true)
  assert.equal(fitsBudget(text, { maxChars: 2 }), false)
  const report = budgetReport(text, { maxChars: 100, maxTokens: 100 })
  assert.equal(report.chars, 4)
  assert.equal(report.tokens, estimateTokens(text))
})
