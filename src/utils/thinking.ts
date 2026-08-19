/**
 * 从 profile 的 params 中检测 thinking 模式是否开启。
 *
 * 思考参数由用户在连接预设的 `params` 里自由配置（如
 * `{ "thinking": { "type": "enabled" }, "reasoning_effort": "max" }`），
 * 代码不再自动注入任何字段。这里只是据此推断模型是否处于思考模式。
 */
export function isThinkingEnabled(params?: Record<string, unknown>): boolean {
    const thinking = params?.thinking;
    return (
        thinking != null &&
        typeof thinking === "object" &&
        (thinking as { type?: unknown }).type === "enabled"
    );
}

/**
 * 判断客户端是否需要为 assistant 消息组装 `reasoning_content` 并回传给 API。
 *
 * 它与「是否向 API 发送 thinking 参数」是两个独立概念：
 * - `params.thinking` 是发给 API 的请求参数，由用户完全掌控；
 * - 是否回传 `reasoning_content` 取决于模型是否处于思考模式：
 *   - DeepSeek 类：显式发送 `thinking: {type:"enabled"}`，必须回传（空串也行）；
 *   - 某些模型默认开启思考：无需（也不能）在 params 传 thinking，
 *     但同样要求回传 `reasoning_content`；
 *   - 非思考模型：不应回传。
 *
 * 优先级：profile 显式配置 `reasoningPassback` > 自动检测 `params.thinking`。
 * DeepSeek 等模型的 thinking 模式若缺少该字段会报 400
 * （"The reasoning_content in the thinking mode must be passed back to the API."）。
 */
export function resolveReasoningPassback(
    params?: Record<string, unknown>,
    reasoningPassback?: boolean
): boolean {
    if (reasoningPassback != null) {
        return reasoningPassback;
    }
    return isThinkingEnabled(params);
}
