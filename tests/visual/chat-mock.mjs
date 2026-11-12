/**
 * Generate simulated chat screenshots for the README.
 *
 * The HTML files are written to tests/visual/out/ (gitignored). They are pure
 * CSS, no external assets or network. Open them in a 1200x760 viewport and
 * screenshot to docs/screenshots/*.png.
 *
 * Run: node tests/visual/chat-mock.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'out')
fs.mkdirSync(outDir, { recursive: true })

function esc(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
}

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1200px; height: 760px; overflow: hidden; }
  body {
    background: #e9edf2;
    font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    color: #1f2328;
  }
  .app { display: flex; gap: 20px; padding: 24px; height: 760px; }
  .chat {
    width: 720px; background: #fff; border-radius: 16px; overflow: hidden;
    box-shadow: 0 12px 32px rgba(31, 35, 40, .12), 0 1px 0 rgba(255,255,255,.8) inset;
    display: flex; flex-direction: column;
  }
  .bar {
    height: 66px; padding: 0 20px; display: flex; align-items: center; gap: 12px;
    border-bottom: 1px solid #edf0f4; background: #fff;
  }
  .bar .ava { width: 38px; height: 38px; border-radius: 50%; font-size: 15px; }
  .bar .who { font-size: 16px; font-weight: 700; }
  .bar .sub { margin-left: 8px; font-size: 12px; color: #8b949e; font-weight: 400; }
  .bar .sp { flex: 1; }
  .pill {
    padding: 3px 9px; border-radius: 999px; background: #fff3cd; color: #7a5b00;
    font-size: 11px; font-weight: 600;
  }
  .chatbody {
    flex: 1; background: #f7f8fa; padding: 18px 20px 20px;
    display: flex; flex-direction: column; justify-content: flex-end; gap: 12px;
  }
  .sep { text-align: center; color: #9aa4b2; font-size: 11px; margin: 2px 0 4px; }
  .msg { display: flex; align-items: flex-end; gap: 9px; }
  .msg.right { flex-direction: row-reverse; }
  .ava {
    width: 34px; height: 34px; border-radius: 50%; flex: none;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 13px; font-weight: 700;
    background: linear-gradient(135deg, #5b8def, #7c6cf0);
  }
  .ava.b { background: linear-gradient(135deg, #2da44e, #1a7f37); }
  .ava.c { background: linear-gradient(135deg, #d68910, #bf8700); }
  .col { max-width: 500px; }
  .meta { color: #8b949e; font-size: 11px; margin: 0 2px 4px; }
  .msg.right .meta { text-align: right; }
  .bubble {
    padding: 10px 14px; border-radius: 12px; background: #fff; color: #1f2328;
    font-size: 15px; line-height: 1.55; box-shadow: 0 1px 2px rgba(31,35,40,.06);
    border: 1px solid #eef1f4;
  }
  .msg.right .bubble { background: #e2ecff; border-color: #d0e0ff; }
  .panel {
    flex: 1; background: #0d1117; border-radius: 16px; overflow: hidden;
    box-shadow: 0 12px 32px rgba(31, 35, 40, .2);
    display: flex; flex-direction: column; color: #c9d1d9;
  }
  .phead { padding: 16px 18px 12px; border-bottom: 1px solid #21262d; }
  .phead .line { display: flex; align-items: center; gap: 8px; }
  .phead .title { font-size: 14px; font-weight: 700; color: #f0f6fc; }
  .phead .sp { flex: 1; }
  .tokens {
    padding: 3px 8px; border-radius: 999px; background: #1f6feb; color: #fff;
    font-size: 11px; font-weight: 700;
  }
  .phead .sub { margin-top: 7px; font-size: 11px; color: #8b949e; }
  pre {
    margin: 0; padding: 14px 18px; flex: 1; overflow: hidden;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; color: #d6deeb;
  }
  pre .k { color: #7ee787; }
  pre .v { color: #ffd580; }
  pre .m { color: #79c0ff; }
  .pfoot {
    padding: 9px 18px; border-top: 1px solid #21262d; color: #8b949e;
    font-size: 11px; display: flex; justify-content: space-between;
  }
`

function message(m) {
  return `
    <div class="msg ${m.side === 'right' ? 'right' : ''}">
      <div class="ava ${m.avatar ?? ''}">${esc(m.initial)}</div>
      <div class="col">
        <div class="meta">${esc(m.name)} · ${esc(m.time)}</div>
        <div class="bubble">${esc(m.text)}</div>
      </div>
    </div>`
}

function injectionHtml(text) {
  // Minimal highlighting for the labels, keeping the exact text readable.
  return text
    .split('\n')
    .map((line) => {
      if (/^【/.test(line)) return `<span class="m">${esc(line)}</span>`
      if (/^(关系|氛围|最近群里发生过|群里的人)/.test(line)) return `<span class="k">${esc(line)}</span>`
      if (/^- /.test(line)) return `<span class="v">${esc(line)}</span>`
      return esc(line)
    })
    .join('\n')
}

function page({ title, subtitle, messages, injection, tokens, badge, footer }) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>
<body>
  <div class="app">
    <section class="chat">
      <div class="bar">
        <div class="ava">${esc(title.slice(0, 1))}</div>
        <div><span class="who">${esc(title)}</span><span class="sub">${esc(subtitle)}</span></div>
        <div class="sp"></div>
        <span class="pill">模拟对话</span>
      </div>
      <div class="chatbody">
        <div class="sep">11-10 21:03</div>
        ${messages.map(message).join('\n')}
      </div>
    </section>
    <section class="panel">
      <div class="phead">
        <div class="line"><span class="title">注入到 system prompt</span><span class="sp"></span><span class="tokens">${esc(tokens)}</span></div>
        <div class="sub">section 8100 · interpolate: false · ${esc(badge)}</div>
      </div>
      <pre>${injectionHtml(injection)}</pre>
      <div class="pfoot"><span>${esc(footer)}</span><span>membubble</span></div>
    </section>
  </div>
</body>
</html>
`
}

const privatePage = page({
  title: '阿川',
  subtitle: '私聊 · 已认识',
  tokens: '≈ 186 tokens',
  badge: 'L1 人物气泡',
  footer: '超预算先丢回忆，人物卡保留',
  messages: [
    { name: '阿川', initial: '阿', text: '在吗？', time: '21:03' },
    { name: '角色', initial: '角', side: 'right', avatar: 'b', text: '在，怎么了？', time: '21:03' },
    { name: '阿川', initial: '阿', text: '想问问你平时喝什么豆子。', time: '21:03' },
    { name: '角色', initial: '角', side: 'right', avatar: 'b', text: '浅烘偏多，果酸明显一点。', time: '21:04' },
    { name: '阿川', initial: '阿', text: '最近在学手冲咖啡。', time: '21:04' },
    { name: '角色', initial: '角', side: 'right', avatar: 'b', text: '怎么突然想学这个？', time: '21:04' },
    { name: '阿川', initial: '阿', text: '公司楼下新开了一家，豆子还行。', time: '21:05' },
    { name: '角色', initial: '角', side: 'right', avatar: 'b', text: '听起来不错，下次试试浅烘。', time: '21:05' },
  ],
  injection: `【人物气泡】你正在和「阿川」说话
关系：相识｜好感 46｜信任 42｜熟悉 12
大致风格：话多，爱反问
你记住的关于对方的事：
- 最近在学手冲咖啡
你对对方的印象：
- 说话直接
你曾对对方说过：
- 她会做红茶
【回忆】你想起：
- [11-10] 他聊起自己最近在学手冲咖啡`,
})

const groupPage = page({
  title: '测试群',
  subtitle: '8 人 · 群聊',
  tokens: '≈ 192 tokens',
  badge: 'L0 群聊气泡 + L1',
  footer: '最多 8 人 / 6 条事件，固定注入',
  messages: [
    { name: '阿杰', initial: '杰', avatar: 'c', text: '有人喝过楼下那家吗？', time: '21:03' },
    { name: '小林', initial: '林', text: '我昨天去了。', time: '21:03' },
    { name: '小林', initial: '林', text: '公司楼下那家咖啡店不错，手冲还行。', time: '21:04' },
    { name: '阿杰', initial: '杰', avatar: 'c', text: '下次一起去。', time: '21:04' },
    { name: '小林', initial: '林', text: '我还不太会用 V60。', time: '21:05' },
    { name: '角色', initial: '角', side: 'right', avatar: 'b', text: '水温别太高，先按 1:15 试试。', time: '21:05' },
  ],
  injection: `【群聊气泡】群「测试群」
氛围：活跃，偏技术向
最近群里发生过：
- 有人分享了一家咖啡店
群里的人：
- 阿杰（还不太熟）

【人物气泡】关于「小林」
…已晋升时是完整卡片；未晋升时只有名字和最近一次互动时间…`,
})

fs.writeFileSync(path.join(outDir, 'private-chat.html'), privatePage)
fs.writeFileSync(path.join(outDir, 'group-chat.html'), groupPage)
console.log(outDir)
