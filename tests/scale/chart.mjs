/**
 * Generate the comparison chart used by the README.
 *
 * Baseline definitions (same synthetic text as tests/scale):
 * - full: every user/assistant turn, or every valid group message;
 * - window20: the last 20 turns/messages;
 * - membubble: the measured injection size from tests/scale (186/192 tokens).
 *
 * Run: node tests/scale/chart.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { estimateTokens } from '../../lib/budget.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const output = path.resolve(here, '../../docs/scale-comparison.svg')

const personalUser = (i) => `第 ${i} 轮：我在说一件具体的事，编号 ${i}。`
const personalAssistant = '嗯，继续说。'
function personalText(from, to) {
  const rows = []
  for (let i = from; i <= to; i += 1) rows.push(`用户：${personalUser(i)}\n角色：${personalAssistant}`)
  return rows.join('\n')
}

function groupText(from, to) {
  const rows = []
  for (let i = from; i <= to; i += 1) {
    if (i % 10 === 0) continue
    rows.push(
      `成员${String(i % 1000).padStart(4, '0')}：第 ${i} 条有效发言，讨论一个具体问题。\n角色：嗯。`,
    )
  }
  return rows.join('\n')
}

const personal = [100, 1000, 3000, 5000].map((turns) => ({
  label: String(turns),
  full: estimateTokens(personalText(1, turns)),
  window: estimateTokens(personalText(Math.max(1, turns - 19), turns)),
  membubble: turns === 100 ? 185 : 186,
}))
const group = [500, 1000, 2000].map((messages) => {
  const valid = Array.from({ length: messages }, (_, i) => i + 1).filter((i) => i % 10 !== 0)
  const tail = valid.slice(-20)
  return {
    label: String(messages),
    full: estimateTokens(groupText(1, messages)),
    window: estimateTokens(groupText(tail[0], tail.at(-1))),
    membubble: 192,
  }
})

const COLORS = { full: '#c0392b', window: '#d68910', membubble: '#1f6feb' }
const NAMES = { full: '全量注入', window: '最近 20 条', membubble: 'dsh-membubble' }
const Y_MIN = 100
const Y_MAX = 1_000_000
const logMin = Math.log10(Y_MIN)
const logMax = Math.log10(Y_MAX)

function esc(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
}

function panel({ x, title, data, xLabel }) {
  const left = x
  const top = 96
  const width = 410
  const height = 280
  const yFor = (value) =>
    top + height - ((Math.log10(value) - logMin) / (logMax - logMin)) * height
  const xFor = (index) => left + (data.length === 1 ? width / 2 : (index / (data.length - 1)) * width)
  const parts = []
  parts.push(`<text x="${left}" y="70" class="title">${esc(title)}</text>`)
  for (const value of [100, 1_000, 10_000, 100_000, 1_000_000]) {
    const y = yFor(value)
    parts.push(`<line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="grid"/>`)
    parts.push(`<text x="${left - 8}" y="${y + 4}" class="tick" text-anchor="end">${value.toLocaleString('en-US')}</text>`)
  }
  parts.push(`<line x1="${left}" x2="${left}" y1="${top}" y2="${top + height}" class="axis"/>`)
  parts.push(`<line x1="${left}" x2="${left + width}" y1="${top + height}" y2="${top + height}" class="axis"/>`)
  data.forEach((row, index) => {
    parts.push(`<text x="${xFor(index)}" y="${top + height + 20}" class="tick" text-anchor="middle">${esc(row.label)}</text>`)
  })
  parts.push(`<text x="${left + width / 2}" y="${top + height + 44}" class="axis-label" text-anchor="middle">${esc(xLabel)}</text>`)
  for (const key of ['full', 'window', 'membubble']) {
    const points = data.map((row, index) => `${xFor(index)},${yFor(row[key])}`).join(' ')
    parts.push(`<polyline points="${points}" fill="none" stroke="${COLORS[key]}" stroke-width="2.5"/>`)
    data.forEach((row, index) => {
      parts.push(`<circle cx="${xFor(index)}" cy="${yFor(row[key])}" r="3.5" fill="${COLORS[key]}"/>`)
    })
    const last = data[data.length - 1]
    const labelX = xFor(data.length - 1) - 6
    parts.push(
      `<text x="${labelX}" y="${yFor(last[key]) - 7}" class="value" text-anchor="end" fill="${COLORS[key]}">${last[key].toLocaleString('en-US')}</text>`,
    )
  }
  return parts.join('\n')
}

const legend = ['full', 'window', 'membubble']
  .map((key, index) => {
    const x = 230 + index * 190
    return `<line x1="${x}" x2="${x + 26}" y1="35" y2="35" stroke="${COLORS[key]}" stroke-width="2.5"/><text x="${x + 32}" y="40" class="legend">${NAMES[key]}</text>`
  })
  .join('\n')

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500" role="img" aria-labelledby="title desc">
  <title id="title">dsh-membubble 与全量注入、最近 20 条的注入 token 对比</title>
  <desc id="desc">左图：个人对话 5000 轮；右图：1000 人群 2000 条消息。全量注入随轮次和群规模线性增长，最近 20 条固定但丢失旧事件，dsh-membubble 固定在 186/192 tokens。</desc>
  <style>
    text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; fill: #1f2328; }
    .title { font-size: 15px; font-weight: 600; }
    .legend { font-size: 12px; }
    .tick { font-size: 11px; fill: #57606a; }
    .axis-label { font-size: 12px; fill: #57606a; }
    .value { font-size: 11px; font-weight: 600; }
    .grid { stroke: #d8dee4; stroke-width: 1; }
    .axis { stroke: #8c959f; stroke-width: 1; }
    .foot { font-size: 11px; fill: #57606a; }
  </style>
  <rect width="1000" height="500" fill="#ffffff"/>
  <text x="500" y="18" text-anchor="middle" class="title">注入文本估算 tokens（越低越好；对数刻度）</text>
  ${legend}
  ${panel({ x: 70, title: '个人长跑：5000 轮', data: personal, xLabel: '对话轮次' })}
  ${panel({ x: 560, title: '千人群：2000 条消息', data: group, xLabel: '群消息数（1000 人轮转）' })}
  <text x="70" y="470" class="foot">全量 = 全部轮次/有效群消息；最近 20 = 最后 20 条；dsh-membubble = 实测注入（186 / 192 tokens）。</text>
  <text x="70" y="488" class="foot">同一合成文本与保守 token 估算；全量注入在 5000 轮时约 192k tokens，已超过常见上下文窗口。</text>
</svg>
`

fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, svg)
console.log(output)
