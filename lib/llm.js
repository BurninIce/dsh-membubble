/**
 * Model access for dsh-membubble.
 *
 * Memory judgments are auxiliary calls. The route is the configured
 * provider/model pair when present; otherwise the plugin remembers the route of
 * the most recent live request and reuses it, so a default Web deployment works
 * with zero configuration.
 */

/**
 * @param {Record<string, any>} config
 * @param {{ snapshotEvents?: () => readonly any[] } | null | undefined} session
 * @returns {{ provider: string, model: string } | null}
 */
export function routeFor(config, session) {
  if (config.provider && config.model) return { provider: config.provider, model: config.model }
  const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'request/context') {
      const { provider, model } = event.data ?? {}
      if (provider && model) return { provider, model }
    }
    if (event?.type === 'request/header') {
      const callConfig = event.data?.header?.config
      if (callConfig?.provider && callConfig?.model) {
        return { provider: callConfig.provider, model: callConfig.model }
      }
    }
  }
  return null
}

/**
 * Build the `complete` function consumed by the engine.
 *
 * @param {{ llm: any }} ctx
 * @param {() => ({ provider: string, model: string } | null)} getRoute
 */
export function makeCompleter(ctx, getRoute) {
  return async function complete(input) {
    const route = getRoute()
    if (!route?.provider || !route?.model) {
      throw new Error('没有可用的模型路由（请配置 provider/model，或先让会话发起一次请求）')
    }
    const signal = AbortSignal.timeout(input.timeoutMs)
    const call = await ctx.llm.prepareCall(
      {
        provider: route.provider,
        model: route.model,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      },
      signal,
    )
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: input.user }],
        source: { kind: 'dsh-membubble' },
      },
    ]
    const options = { ...call.config, messages, system: input.system, signal }
    let deltaText = ''
    let blockText = ''
    let finish
    for await (const chunk of call.stream(options)) {
      if (chunk.type === 'text-delta') deltaText += chunk.text
      else if (chunk.type === 'block-end' && chunk.block?.type === 'text') blockText += chunk.block.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      throw new Error(finish.failure?.message ?? `模型调用中止（${finish.kind}）`)
    }
    const text = (deltaText || blockText).trim()
    if (!text) throw new Error('模型没有返回文本')
    return text
  }
}
