# 集成 harness

`membubble.mjs` 把 `dsh-membubble` 挂到真实的 Cordis 上下文上，用假的 `systemPrompt`、`tools`、`commands`、`llm` 服务，跑一遍单元测试覆盖不到的接线：

`agent/created` → section → 轮次事件 → 判官 → 事件 → 归纳 → 晋升 → 群气泡 → 工具/命令。

它不随 npm 包发布，也不在 CI 里跑，因为需要一份 dsh 安装来解析 `@deepseek-ai/*`。

## 运行

在仓库根目录：

```powershell
$root = npm root -g
$env:DSH_PKG_ROOT = "$root\@deepseek-ai\dsh\node_modules"
npm run test:integration
```

或者直接：

```powershell
node --import ./tests/integration/register-dsh-packages.mjs ./tests/integration/membubble.mjs
```

harness 会创建临时 `DSH_HOME` 并在成功后删除，不会碰真实 profile 或真实记忆。
