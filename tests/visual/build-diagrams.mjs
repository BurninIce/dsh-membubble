/**
 * Build the README diagrams as standalone 1600x900 SVGs.
 *
 * Layout rules (from the pptlab figure checklist):
 * - 1600x900 canvas, >=60px margin, no element clipping;
 * - connectors run in the gaps between boxes and never through box text;
 * - one idea per box, no duplicate labels;
 * - 18–24px source text so it stays readable when scaled into README.
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
  pink: '#bf3989',
  pinkBg: '#ffeff7',
  purple: '#8250df',
  purpleBg: '#fbefff',
  gray: '#f6f8fa',
}

function esc(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
}

function svg({ body, title }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1600 900" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.line}"/>
    </marker>
  </defs>
  <style>
    text { font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif; fill: ${C.ink}; }
    .h { font-size: 38px; font-weight: 700; }
    .sub { font-size: 19px; fill: ${C.muted}; }
    .title { font-size: 24px; font-weight: 700; }
    .b { font-size: 20px; }
    .s { font-size: 17px; fill: ${C.muted}; }
    .n { font-size: 15px; fill: ${C.muted}; }
    .arr { stroke: ${C.line}; stroke-width: 2; fill: none; marker-end: url(#arrow); }
    .dash { stroke: ${C.line}; stroke-width: 2; fill: none; stroke-dasharray: 7 6; marker-end: url(#arrow); }
  </style>
  <rect width="1600" height="900" fill="#ffffff"/>
  ${body}
</svg>
`
}

function rect({ x, y, w, h, fill, stroke = C.border, dash = false }) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="2"${dash ? ' stroke-dasharray="7 6"' : ''}/>`
}

function text(x, y, value, cls = 'b', extra = '') {
  return `<text x="${x}" y="${y}" class="${cls}" ${extra}>${esc(value)}</text>`
}

function card({ x, y, w, h, fill, stroke = C.border, title, lines = [], dash = false }) {
  const parts = [rect({ x, y, w, h, fill, stroke, dash })]
  parts.push(text(x + 26, y + 38, title, 'title'))
  lines.forEach((line, index) => {
    parts.push(text(x + 26, y + 72 + index * 28, line, 's'))
  })
  return parts.join('\n')
}

function arrow(d, dash = false) {
  return `<path d="${d}" class="${dash ? 'dash' : 'arr'}"/>`
}

function header(title, subtitle) {
  return `${text(60, 72, title, 'h')}\n${text(60, 108, subtitle, 'sub')}`
}

function footer(lines) {
  return lines.map((line, index) => text(60, 832 + index * 26, line, 'n')).join('\n')
}

/* ---------------------------------------------------------------- layers */
{
  const body = []
  body.push(header('三层记忆结构', '分层是存储结构；注入时只展开当前说话人有权看到的部分。'))

  body.push(card({
    x: 420, y: 150, w: 760, h: 150, fill: C.blueBg, stroke: C.blue,
    title: 'L0  群聊气泡',
    lines: [
      '群体氛围 · 无人称的近期事件 · 成员的名字与模糊风格',
      '不保存谁说了什么；已知成员名落盘前替换成「有人」',
    ],
  }))
  body.push(card({
    x: 60, y: 168, w: 320, h: 112, fill: C.gray, dash: true,
    title: '群聊里所有人',
    lines: ['看到的是一层模糊印象'],
  }))
  body.push(card({
    x: 1220, y: 168, w: 320, h: 112, fill: C.gray, dash: true,
    title: '例外：group.buffer',
    lines: ['待归纳的短期原文，成功即清空'],
  }))

  body.push(arrow('M 800 300 L 800 390'))
  body.push(text(824, 335, '晋升判定', 'b'))
  body.push(text(824, 362, '事件 ≥ N + 判官 promote:true', 'n'))

  body.push(card({
    x: 420, y: 390, w: 760, h: 150, fill: C.amberBg, stroke: C.amber,
    title: 'L1  人物气泡',
    lines: [
      '事件 · 事实 · 印象 · 自我披露 · 关系数值',
      '按人隔离；只有当前说话人的文件会被读取和渲染',
    ],
  }))
  body.push(card({
    x: 60, y: 408, w: 320, h: 112, fill: C.gray, dash: true,
    title: '只属于这个人',
    lines: ['A 的注入读不到 B 的卡片'],
  }))
  body.push(card({
    x: 1220, y: 408, w: 320, h: 112, fill: C.gray, dash: true,
    title: '晋升是单向的',
    lines: ['晋升后不会退回 L0'],
  }))

  body.push(arrow('M 800 540 L 800 630'))
  body.push(text(824, 575, '部署配置', 'b'))
  body.push(text(824, 602, '不在本插件管理范围', 'n'))

  body.push(card({
    x: 420, y: 630, w: 760, h: 110, fill: C.gray,
    title: 'L2  完整人物卡',
    lines: ['角色卡 / 人设层：由部署方的角色资产提供'],
  }))
  body.push(card({
    x: 60, y: 648, w: 320, h: 110, fill: C.gray, dash: true,
    title: '部署层',
    lines: ['角色卡 / 人设 / 资产'],
  }))
  body.push(card({
    x: 1220, y: 648, w: 320, h: 110, fill: C.gray, dash: true,
    title: '不是聊天记录',
    lines: ['只保留无人称事件'],
  }))

  body.push(footer([
    '注：group.buffer 是待归纳的短期原文，属于明文例外；L0 的最终字段不保存言论。',
  ]))
  fs.writeFileSync(path.join(outDir, 'layers.svg'), svg({ body: body.join('\n'), title: '三层记忆结构' }))
}

/* -------------------------------------------------------------- pipeline */
{
  const body = []
  body.push(header('单轮处理路径：私聊 / active 成员', '群聊先由焦点决定谁进入这条管线；私聊直接进入。'))
  body.push(text(60, 162, '输入与缓冲', 'n'))
  body.push(text(600, 162, '判官', 'n'))
  body.push(text(880, 162, '事件与归档', 'n'))

  // Main row: y=200..320
  body.push(card({
    x: 60, y: 200, w: 200, h: 120, fill: C.blueBg, stroke: C.blue,
    title: 'turn/end',
    lines: ['一轮结束', '只取 human 输入'],
  }))
  body.push(card({
    x: 320, y: 200, w: 220, h: 120, fill: C.gray,
    title: 'pending 缓冲',
    lines: ['追加本轮', '立即落盘'],
  }))
  body.push(card({
    x: 600, y: 200, w: 220, h: 120, fill: C.amberBg, stroke: C.amber,
    title: '判官：结束？',
    lines: ['后台队列', '失败保留缓冲'],
  }))
  body.push(card({
    x: 880, y: 200, w: 200, h: 120, fill: C.greenBg, stroke: C.green,
    title: '事件',
    lines: ['摘要 + 重要度', '计数 +1'],
  }))
  body.push(card({
    x: 1140, y: 200, w: 240, h: 120, fill: C.greenBg, stroke: C.green,
    title: '归纳 / 晋升',
    lines: ['每 inductEvery 条事件', '群聊：满足条件时晋升'],
  }))

  body.push(arrow('M 260 260 L 310 260'))
  body.push(arrow('M 540 260 L 590 260'))
  body.push(arrow('M 820 260 L 870 260'))
  body.push(arrow('M 1080 260 L 1130 260'))
  body.push(text(850, 238, '写事件', 'n', 'text-anchor="middle"'))
  body.push(text(1110, 238, '每N条', 'n', 'text-anchor="middle"'))

  // Branch row: y=420..530
  body.push(card({
    x: 320, y: 420, w: 220, h: 120, fill: C.gray,
    title: 'continue',
    lines: ['继续缓冲', '下一轮再判'],
  }))
  body.push(card({
    x: 600, y: 420, w: 220, h: 120, fill: C.gray,
    title: 'close · 不值得',
    lines: ['丢弃缓冲', '不写半成品事件'],
  }))
  body.push(card({
    x: 880, y: 420, w: 200, h: 120, fill: C.pinkBg, stroke: C.pink,
    title: '活跃 ≤ 400',
    lines: ['溢出的事件'],
  }))
  body.push(card({
    x: 1140, y: 420, w: 240, h: 120, fill: C.pinkBg, stroke: C.pink,
    title: 'archive.jsonl',
    lines: ['append-only', 'recall 可检索'],
  }))

  // judge -> continue (left channel), then continue returns to pending bottom
  body.push(arrow('M 600 292 L 570 292 L 570 480 L 540 480'))
  body.push(arrow('M 400 420 L 400 320'))
  // judge -> discard
  body.push(arrow('M 710 320 L 710 420'))
  // event -> active -> archive
  body.push(arrow('M 980 320 L 980 420'))
  body.push(arrow('M 1080 480 L 1130 480'))
  body.push(text(1110, 462, '归档', 'n', 'text-anchor="middle"'))

  body.push(card({
    x: 60, y: 620, w: 1440, h: 140, fill: C.gray, dash: true,
    title: '失败与队列边界',
    lines: ['判官失败：保留缓冲，下一轮再判；不写半成品事件。', '归档失败：保留在活跃列表；模型调用在后台队列，不阻塞回复。'],
  }))

  body.push(footer([
    '群聊先按焦点分轨：active 走本图，buffer 只记事件，第 11 人起只进群氛围。',
  ]))
  fs.writeFileSync(path.join(outDir, 'pipeline.svg'), svg({ body: body.join('\n'), title: '单轮处理路径：私聊与 active 成员' }))
}

/* ------------------------------------------------------------- group focus */
{
  const body = []
  body.push(header('大群路径：焦点决定谁进个人管线', '群人数只影响名册查找；注入与判官调用由焦点上限决定。'))

  body.push(card({
    x: 60, y: 170, w: 220, h: 120, fill: C.blueBg, stroke: C.blue,
    title: '群消息',
    lines: ['1000 个说话人', '也可以'],
  }))
  body.push(card({
    x: 360, y: 170, w: 240, h: 120, fill: C.gray,
    title: '噪音过滤',
    lines: ['草 / 6666 / 表情 / 复读', '直接 @ 或点名放行'],
  }))
  body.push(card({
    x: 660, y: 160, w: 340, h: 140, fill: C.amberBg, stroke: C.amber,
    title: '焦点板',
    lines: ['最近 60 条 · 6 小时', '加权 importance + 发言轮数'],
  }))

  body.push(arrow('M 280 230 L 350 230'))
  body.push(arrow('M 600 230 L 650 230'))

  // Fan out from the focus board; the trunk is split at two y channels so the
  // three branches never share the same horizontal run.
  body.push(arrow('M 830 300 L 830 330 L 270 330 L 270 390'))
  body.push(arrow('M 830 300 L 830 350 L 690 350 L 690 390'))
  body.push(arrow('M 830 350 L 1190 350 L 1190 390'))

  body.push(card({
    x: 100, y: 390, w: 340, h: 140, fill: C.greenBg, stroke: C.green,
    title: 'active · 前 5 人',
    lines: ['判官 + 事件 + 归纳/晋升', '注入完整人物卡'],
  }))
  body.push(card({
    x: 520, y: 390, w: 340, h: 140, fill: C.blueBg, stroke: C.blue,
    title: 'buffer · 后 5 人',
    lines: ['判官 + 事件，不归纳', '晋升推迟，不建完整卡'],
  }))
  body.push(card({
    x: 940, y: 390, w: 340, h: 140, fill: C.gray,
    title: '其他 · 第 11 人起',
    lines: ['只进群氛围', '不建个人事件'],
  }))

  body.push(arrow('M 270 530 L 270 570'))
  body.push(arrow('M 690 530 L 690 570'))
  body.push(arrow('M 1190 530 L 1190 570'))

  body.push(card({
    x: 60, y: 570, w: 1360, h: 120, fill: C.blueBg, stroke: C.blue,
    title: '群氛围归纳',
    lines: ['每 20 条有效消息，且间隔 ≥180 秒；只读最近 20 条', '输出：氛围 / 无人称事件 / 成员风格（均有字数上限）'],
  }))
  body.push(arrow('M 740 690 L 740 720'))
  body.push(card({
    x: 60, y: 720, w: 1360, h: 90, fill: C.gray,
    title: '群聊气泡（注入）',
    lines: ['最多 8 人 / 6 条事件；固定上限，与群人数无关'],
  }))

  body.push(footer([
    '事件去留：群事件活跃上限 20 条，溢出写 groups/<id>.archive.jsonl；个人事件活跃上限 400 条，归档可被 recall 检索。',
    '代价：buffer 不归纳、第 11 人起只进群氛围；没有 direct 信号时，插件无法判断普通群聊是否关键。',
  ]))
  fs.writeFileSync(path.join(outDir, 'group-focus.svg'), svg({ body: body.join('\n'), title: '大群路径：焦点决定谁进个人管线' }))
}

/* --------------------------------------------------------------- identity */
{
  const body = []
  body.push(header('同一个人：私聊和群聊只展开一份 L1', '一个 speakerId 对应一个 persons 文件；群聊额外展开 L0。'))

  body.push(card({
    x: 80, y: 170, w: 360, h: 140, fill: C.blueBg, stroke: C.blue,
    title: '私聊会话',
    lines: ['binding.mode = personal', '只渲染当前说话人的 L1'],
  }))
  body.push(card({
    x: 1160, y: 170, w: 360, h: 140, fill: C.amberBg, stroke: C.amber,
    title: '群聊会话',
    lines: ['binding.mode = group', '渲染 L0 + 当前说话人的 L1'],
  }))

  body.push(card({
    x: 620, y: 360, w: 360, h: 190, fill: C.purpleBg, stroke: C.purple,
    title: 'L1  人物气泡',
    lines: ['persons/<speakerId>.json', '事件 / 事实 / 印象 / 关系', '同一份，不按聊天类型复制'],
  }))
  body.push(card({
    x: 1160, y: 390, w: 360, h: 170, fill: C.amberBg, stroke: C.amber,
    title: 'L0  群聊气泡',
    lines: ['群氛围 + 无人称事件', '其他人的名字与模糊风格', '当前说话人已从「群里的人」移除'],
  }))

  body.push(arrow('M 260 310 L 260 330 L 620 330 L 620 360'))
  body.push(text(292, 322, '只渲染 L1', 'n'))
  body.push(arrow('M 1340 310 L 1340 390'))
  body.push(text(1358, 354, 'L0', 'n'))
  body.push(arrow('M 1160 240 L 1100 240 L 1100 455 L 980 455'))
  body.push(text(1000, 447, 'L1', 'n'))

  body.push(card({
    x: 80, y: 620, w: 1440, h: 90, fill: C.gray, dash: true,
    title: '去重规则',
    lines: ['同一轮注入只会出现一个人物块；group.buffer 是短期原文，不是第二份卡片。'],
  }))
  body.push(footer([
    '私聊注入 = L1；群聊注入 = L0 + 当前说话人的 L1。speakerId 必须稳定：昵称变化不新建，id 变化会被当成两个人。',
    '如果同一人出现在多个群，L1 共享；各群 L0 分开。',
  ]))
  fs.writeFileSync(path.join(outDir, 'identity.svg'), svg({ body: body.join('\n'), title: '同一个人：私聊和群聊只展开一份 L1' }))
}

/* -------------------------------------------------------------- promotion */
{
  const body = []
  body.push(header('晋升：从 L0 群成员到 L1 人物气泡', '晋升是单向的；默认说话人直接是 L1，buffer 不触发晋升。'))

  body.push(card({
    x: 80, y: 220, w: 340, h: 160, fill: C.blueBg, stroke: C.blue,
    title: 'L0  群成员',
    lines: ['名字 + 模糊风格', 'promoted = false', '事件先作为晋升材料'],
  }))
  body.push(card({
    x: 500, y: 220, w: 420, h: 160, fill: C.amberBg, stroke: C.amber,
    title: '晋升判定',
    lines: ['仅 active 成员；buffer 不参与', 'episodes ≥ promotionMinEpisodes（默认 3）', '判官必须输出 promote:true'],
  }))
  body.push(card({
    x: 1000, y: 220, w: 360, h: 160, fill: C.greenBg, stroke: C.green,
    title: 'L1  人物气泡',
    lines: ['完整卡片 + 关系数值', '注入 / recall 全部打开', 'promoted = true，记录 promotedAt'],
  }))

  body.push(arrow('M 420 300 L 490 300'))
  body.push(arrow('M 920 300 L 990 300'))
  body.push(text(430, 282, '累积事件', 'n'))
  body.push(text(930, 282, '通过', 'n'))

  body.push(arrow('M 710 380 L 710 450'))
  body.push(card({
    x: 500, y: 460, w: 420, h: 100, fill: C.gray,
    title: '不通过 / 未达阈值',
    lines: ['保持 L0；下次事件闭合后再判'],
  }))
  body.push(text(728, 438, '否', 'n'))

  body.push(card({
    x: 80, y: 460, w: 340, h: 100, fill: C.gray, dash: true,
    title: '默认说话人',
    lines: ['直接按 L1 处理'],
  }))
  body.push(card({
    x: 1000, y: 460, w: 360, h: 100, fill: C.gray, dash: true,
    title: '手动晋升',
    lines: ['/membubble promote'],
  }))

  body.push(card({
    x: 80, y: 620, w: 1280, h: 100, fill: C.pinkBg, stroke: C.pink,
    title: '晋升之后',
    lines: ['L0 保留，不会被清空；L1 独立归纳；promoted=true 后不降级。'],
  }))
  body.push(footer([
    '晋升不改写 L0 的无人称事件；它只是为该成员打开 L1 的完整卡片与关系数值。',
    '未晋升的群成员仍会记录事件，但注入和 recall 只给名字与最近互动时间。',
  ]))
  fs.writeFileSync(path.join(outDir, 'promotion.svg'), svg({ body: body.join('\n'), title: '晋升：从 L0 群成员到 L1 人物气泡' }))
}

console.log(outDir)
