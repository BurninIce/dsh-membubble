/**
 * Build the README diagrams as standalone SVGs.
 *
 * Run: node tests/visual/build-diagrams.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../docs/diagrams')
fs.mkdirSync(outDir, { recursive: true })

const C = {
  ink: '#1f2328',
  muted: '#57606a',
  line: '#8c959f',
  border: '#d0d7de',
  blue: '#1f6feb',
  blueBg: '#ddf4ff',
  amber: '#9a6700',
  amberBg: '#fff8c5',
  green: '#1a7f37',
  greenBg: '#dafbe1',
  gray: '#f6f8fa',
  pink: '#bf3989',
  pinkBg: '#ffeff7',
}

function esc(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
}

const defs = `<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.line}"/>
  </marker>
</defs>`

function svg({ width, height, body, title }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  ${defs}
  <style>
    text { font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif; fill: ${C.ink}; }
    .h { font-size: 20px; font-weight: 700; }
    .t { font-size: 15px; font-weight: 600; }
    .s { font-size: 12.5px; fill: ${C.muted}; }
    .n { font-size: 12px; fill: ${C.muted}; }
    .badge { font-size: 11.5px; font-weight: 600; }
    .arr { stroke: ${C.line}; stroke-width: 1.6; fill: none; marker-end: url(#arrow); }
  </style>
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  ${body}
</svg>
`
}

function box({ x, y, w, h, fill, stroke = C.border, rx = 10, dash }) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"${dash ? ' stroke-dasharray="5 4"' : ''}/>`
}

function text(x, y, value, cls = 't', extra = '') {
  return `<text x="${x}" y="${y}" class="${cls}" ${extra}>${esc(value)}</text>`
}

function arrow(d, extra = '') {
  return `<path d="${d}" class="arr" ${extra}/>`
}

/* ---------------------------------------------------------------- layers */
{
  const width = 980
  const height = 500
  const body = []
  body.push(text(40, 42, '三层记忆结构', 'h'))
  body.push(text(40, 66, '分层是存储结构；对外的三条硬约束见 README 开头。', 's'))

  body.push(box({ x: 240, y: 92, w: 500, h: 108, fill: C.blueBg, stroke: C.blue }))
  body.push(text(264, 122, 'L0  群聊气泡', 't'))
  body.push(text(264, 148, '群体氛围 · 无人称近期事件 · 成员名字与模糊风格（有则记）', 's'))
  body.push(text(264, 170, '不保存谁说了什么；已知成员名落盘前替换为「有人」', 's'))
  body.push(box({ x: 40, y: 112, w: 170, h: 66, fill: C.gray, dash: true }))
  body.push(text(58, 138, '群聊里所有人', 't'))
  body.push(text(58, 158, '可见的模糊印象', 's'))

  body.push(arrow('M 490 200 L 490 240'))
  body.push(text(505, 226, '晋升判定', 'n'))
  body.push(text(505, 244, 'importance + 互动次数', 's'))

  body.push(box({ x: 240, y: 252, w: 500, h: 108, fill: C.amberBg, stroke: C.amber }))
  body.push(text(264, 282, 'L1  人物气泡', 't'))
  body.push(text(264, 308, '事件 · 事实 · 印象 · 自我披露 · 关系数值', 's'))
  body.push(text(264, 330, '按人隔离；只有当前说话人的文件会被读取和渲染', 's'))
  body.push(box({ x: 40, y: 272, w: 170, h: 66, fill: C.gray, dash: true }))
  body.push(text(58, 298, '只属于这个人', 't'))
  body.push(text(58, 318, 'A 看不到 B 的卡片', 's'))

  body.push(arrow('M 490 360 L 490 396'))
  body.push(text(505, 382, '部署配置', 'n'))
  body.push(text(505, 400, '不在本插件管理范围', 's'))

  body.push(box({ x: 240, y: 406, w: 500, h: 62, fill: C.gray }))
  body.push(text(264, 432, 'L2  完整人物卡', 't'))
  body.push(text(264, 452, '角色卡 / 人设层：由部署方的角色资产提供', 's'))

  body.push(text(40, 488, '注：group.buffer 是待归纳的短期原文，属于明文例外，见 README「三层」与「隐私」。', 'n'))
  fs.writeFileSync(path.join(outDir, 'layers.svg'), svg({ width, height, body: body.join('\n'), title: '三层记忆结构' }))
}

/* -------------------------------------------------------------- pipeline */
{
  const width = 1120
  const height = 470
  const body = []
  body.push(text(40, 42, '单轮处理路径：私聊 / active 成员', 'h'))
  body.push(text(40, 66, '群聊先由焦点决定谁进入这条管线；见下一张图。', 's'))

  body.push(box({ x: 40, y: 104, w: 150, h: 62, fill: C.blueBg, stroke: C.blue }))
  body.push(text(58, 132, 'turn/end', 't'))
  body.push(text(58, 154, '一轮结束', 's'))

  body.push(arrow('M 190 135 L 238 135'))
  body.push(box({ x: 240, y: 104, w: 190, h: 62, fill: C.gray }))
  body.push(text(258, 132, 'pending 缓冲', 't'))
  body.push(text(258, 154, '立即落盘，不阻塞回复', 's'))

  body.push(arrow('M 430 135 L 478 135'))
  body.push(box({ x: 480, y: 104, w: 190, h: 62, fill: C.amberBg, stroke: C.amber }))
  body.push(text(498, 132, '判官：话题结束？', 't'))
  body.push(text(498, 154, '后台队列，失败保留缓冲', 's'))

  body.push(arrow('M 480 135 L 440 135 L 440 208'))
  body.push(box({ x: 250, y: 208, w: 190, h: 58, fill: C.gray }))
  body.push(text(268, 234, 'continue', 't'))
  body.push(text(268, 254, '继续缓冲，下一轮再判', 's'))
  body.push(arrow('M 345 208 L 345 166'))

  body.push(arrow('M 670 135 L 718 135'))
  body.push(box({ x: 720, y: 104, w: 160, h: 62, fill: C.gray }))
  body.push(text(738, 132, 'close · 不值得', 't'))
  body.push(text(738, 154, '丢弃缓冲', 's'))

  body.push(arrow('M 575 166 L 575 300'))
  body.push(box({ x: 470, y: 302, w: 210, h: 62, fill: C.greenBg, stroke: C.green }))
  body.push(text(488, 330, 'close · 值得', 't'))
  body.push(text(488, 352, '写一条事件，计数 +1', 's'))

  body.push(arrow('M 680 333 L 728 333'))
  body.push(box({ x: 730, y: 302, w: 180, h: 62, fill: C.greenBg, stroke: C.green }))
  body.push(text(748, 330, '归纳 / 晋升', 't'))
  body.push(text(748, 352, '每 inductEvery 条事件', 's'))

  body.push(arrow('M 575 364 L 575 400'))
  body.push(box({ x: 400, y: 402, w: 230, h: 52, fill: C.gray }))
  body.push(text(418, 426, '活跃事件 ≤ 400', 't'))
  body.push(text(418, 444, '超出部分写入归档', 's'))
  body.push(arrow('M 630 428 L 690 428'))
  body.push(box({ x: 692, y: 402, w: 250, h: 52, fill: C.pinkBg, stroke: C.pink }))
  body.push(text(710, 426, 'archive.jsonl → recall 可检索', 't'))
  body.push(text(710, 444, '高 importance 最后淘汰', 's'))

  body.push(text(40, 456, '溢出的事件不会静默消失：写归档后从活跃列表淘汰；归档写入失败时保留在活跃列表。', 'n'))
  fs.writeFileSync(path.join(outDir, 'pipeline.svg'), svg({ width, height, body: body.join('\n'), title: '单轮处理路径：私聊与 active 成员' }))
}

/* ------------------------------------------------------------- group focus */
{
  const width = 1120
  const height = 560
  const body = []
  body.push(text(40, 42, '大群路径：焦点决定谁进个人管线', 'h'))
  body.push(text(40, 66, '群人数只影响名册查找；注入与判官调用由焦点上限决定。', 's'))

  body.push(box({ x: 40, y: 104, w: 170, h: 66, fill: C.blueBg, stroke: C.blue }))
  body.push(text(58, 132, '群消息', 't'))
  body.push(text(58, 154, '1000 个说话人也可以', 's'))
  body.push(arrow('M 210 137 L 258 137'))

  body.push(box({ x: 260, y: 104, w: 190, h: 66, fill: C.gray }))
  body.push(text(278, 132, '噪音过滤', 't'))
  body.push(text(278, 154, '草 / 6666 / 表情 / 复读', 's'))
  body.push(text(278, 176, '直接 @ 或点名永远放行', 's'))
  body.push(arrow('M 450 137 L 498 137'))

  body.push(box({ x: 500, y: 96, w: 260, h: 82, fill: C.amberBg, stroke: C.amber }))
  body.push(text(518, 124, '焦点板', 't'))
  body.push(text(518, 146, '最近 60 条 · 6 小时', 's'))
  body.push(text(518, 164, '加权 importance + 发言轮数', 's'))

  body.push(arrow('M 630 178 L 630 210'))
  body.push(arrow('M 530 178 L 530 210'))
  body.push(arrow('M 500 178 L 500 195 L 155 195 L 155 212'))
  body.push(box({ x: 40, y: 212, w: 230, h: 90, fill: C.greenBg, stroke: C.green }))
  body.push(text(58, 240, 'active · 前 5 人', 't'))
  body.push(text(58, 264, '判官 + 事件 + 归纳/晋升', 's'))
  body.push(text(58, 282, '注入完整人物卡', 's'))

  body.push(box({ x: 292, y: 212, w: 230, h: 90, fill: C.blueBg, stroke: C.blue }))
  body.push(text(310, 240, 'buffer · 后 5 人', 't'))
  body.push(text(310, 264, '判官 + 事件，不归纳', 's'))
  body.push(text(310, 282, '晋升推迟，不建完整卡', 's'))

  body.push(box({ x: 544, y: 212, w: 230, h: 90, fill: C.gray }))
  body.push(text(562, 240, '其他 · 第 11 人起', 't'))
  body.push(text(562, 264, '只进群氛围', 's'))
  body.push(text(562, 282, '不建个人事件', 's'))

  body.push(arrow('M 155 302 L 155 340'))
  body.push(arrow('M 407 302 L 407 340'))
  body.push(arrow('M 659 302 L 659 340'))
  body.push(box({ x: 40, y: 342, w: 734, h: 82, fill: C.blueBg, stroke: C.blue }))
  body.push(text(58, 370, '群氛围归纳', 't'))
  body.push(text(58, 394, '每 20 条有效消息，且间隔 ≥180 秒；只读最近 20 条', 's'))
  body.push(text(58, 414, '输出：氛围 / 无人称事件 / 成员风格（均有字数上限）', 's'))

  body.push(arrow('M 774 383 L 822 383'))
  body.push(box({ x: 824, y: 342, w: 256, h: 82, fill: C.gray }))
  body.push(text(842, 370, '群聊气泡（注入）', 't'))
  body.push(text(842, 394, '最多 8 人 / 6 条事件', 's'))
  body.push(text(842, 414, '固定上限，与群人数无关', 's'))

  body.push(box({ x: 40, y: 452, w: 1040, h: 78, fill: '#ffffff', dash: true }))
  body.push(text(58, 478, '事件去留', 't'))
  body.push(text(58, 500, '群事件活跃上限 20 条；溢出写 groups/<id>.archive.jsonl。个人事件活跃上限 400 条，归档可被 recall 检索。', 's'))
  body.push(text(58, 520, '代价：buffer 不归纳、第 11 人起只进群氛围；没有 direct 信号时插件无法判断普通群聊是否关键。', 's'))

  body.push(text(40, 552, '合成检查：1000 人 / 2000 条消息 → 注入 192 tokens、焦点 60 条、群成员 10 人、群事件 20 + 归档 70。', 'n'))
  fs.writeFileSync(path.join(outDir, 'group-focus.svg'), svg({ width, height, body: body.join('\n'), title: '大群路径：焦点决定谁进个人管线' }))
}

console.log(outDir)
