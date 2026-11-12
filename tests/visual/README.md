# README 视觉资产

这里放 README 的图和生产脚本，不随 npm 包发布；只有 `docs/` 下的图片会被打进包。

## 流程图

```sh
node tests/visual/build-diagrams.mjs
```

输出：

- `docs/diagrams/layers.svg`
- `docs/diagrams/pipeline.svg`
- `docs/diagrams/group-focus.svg`
- `docs/diagrams/identity.svg`
- `docs/diagrams/promotion.svg`

## 模拟聊天截图

```sh
node tests/visual/chat-mock.mjs
```

输出到 `tests/visual/out/`（已 gitignore）：

- `private-chat.html`
- `group-chat.html`

在 1200×760 的浏览器视口打开，分别截图到：

- `docs/screenshots/private-chat.png`
- `docs/screenshots/group-chat.png`

HTML 是纯 CSS，不引用外部图片或网络资源。截图里的对话和注入内容都是模拟数据，不包含真实用户记录。
