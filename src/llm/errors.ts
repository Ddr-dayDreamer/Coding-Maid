/**
 * LLM 请求错误分类
 *
 * 把 OpenAI SDK / 底层 fetch / Node 网络栈抛出的原始错误，归一化成
 * 可展示给用户的结构化信息（中文标题、建议、错误码、可重试标记）。
 */

// ─── 类型 ────────────────────────────────────────────────

export type LlmErrorCode =
  | "aborted"
  | "auth"
  | "quota"
  | "rate_limit"
  | "server"
  | "bad_request"
  | "context_length"
  | "network"
  | "dns"
  | "tls"
  | "proxy"
  | "timeout"
  | "empty_response"
  | "incomplete"
  | "unknown";

export type LlmErrorInfo = {
  code: LlmErrorCode;
  /** 简短中文标题，例如“连接中断” */
  title: string;
  /** 面向用户的说明与建议 */
  message: string;
  /** 原始错误链（已脱敏），用于展开查看 */
  detail: string;
  httpStatus?: number;
  /** 是否值得自动重试 */
  retryable: boolean;
};

type ErrorNode = {
  name: string;
  message: string;
  code?: string;
  status?: number;
};

type ErrorTemplate = Pick<LlmErrorInfo, "title" | "message" | "retryable">;

// ─── 模板 ────────────────────────────────────────────────

const TEMPLATES: Record<LlmErrorCode, ErrorTemplate> = {
  aborted: {
    title: "请求已中断",
    message: "请求被主动中断，未收到完整回复。",
    retryable: false,
  },
  auth: {
    title: "认证失败",
    message: "API Key 无效、已过期，或当前账号没有访问该模型的权限。请检查连接配置中的 API Key 与 baseURL。",
    retryable: false,
  },
  quota: {
    title: "账户额度不足",
    message: "API 提供商返回额度不足或计费限制。请检查账户余额/配额。",
    retryable: false,
  },
  rate_limit: {
    title: "请求过于频繁",
    message: "API 提供商限流（HTTP 429）。稍后再试，或降低请求频率。",
    retryable: true,
  },
  server: {
    title: "API 服务器错误",
    message: "API 服务器返回 5xx。通常是上游服务临时故障，可稍后重试。",
    retryable: true,
  },
  bad_request: {
    title: "请求被 API 拒绝",
    message: "请求参数或模型名称不被该 API 接受。请检查连接配置中的模型名称、baseURL 与附加参数（params）。",
    retryable: false,
  },
  context_length: {
    title: "上下文超出模型限制",
    message: "对话长度超过模型的上下文窗口。请回退到较早的消息或新建会话后重试。",
    retryable: false,
  },
  network: {
    title: "连接中断",
    message: "与 API 服务器的连接意外断开。请检查网络或代理设置后重试。",
    retryable: true,
  },
  dns: {
    title: "域名解析失败",
    message: "无法解析 API 服务器地址。请检查 baseURL、网络与 DNS/代理设置。",
    retryable: true,
  },
  tls: {
    title: "TLS 连接失败",
    message: "与 API 服务器的 TLS/证书校验未通过。请检查代理、证书或改用正确的 baseURL 协议。",
    retryable: true,
  },
  proxy: {
    title: "代理连接失败",
    message: "无法通过代理连接到 API 服务器。请检查系统/环境变量中的代理配置。",
    retryable: true,
  },
  timeout: {
    title: "请求超时",
    message: "在限定时间内没有收到 API 响应。请检查网络质量，或调大设置中的请求超时时间。",
    retryable: true,
  },
  empty_response: {
    title: "服务器返回空响应",
    message: "API 返回了空内容（既没有文本也没有工具调用），通常是连接被中途掐断。可直接重试。",
    retryable: true,
  },
  incomplete: {
    title: "回复被截断",
    message: "模型只输出了思考内容，没有产出最终回答（多见于 max_tokens 太小或输出被截断）。请调大 max_tokens，或点击“继续”让模型接着生成。",
    retryable: false,
  },
  unknown: {
    title: "请求失败",
    message: "请求 API 时发生未知错误，可展开详情查看原始信息。",
    retryable: false,
  },
};

// ─── 错误链解析 ──────────────────────────────────────────

function collectErrorChain(error: unknown): ErrorNode[] {
  const nodes: ErrorNode[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current != null && typeof current === "object" && !seen.has(current) && nodes.length < 8) {
    seen.add(current);
    const obj = current as Record<string, unknown>;
    const rawCode = obj.code ?? obj.errno;
    const ctorName = (current as { constructor?: { name?: string } }).constructor?.name;
    const declaredName = typeof obj.name === "string" ? obj.name : "";
    nodes.push({
      name: declaredName && declaredName !== "Error" ? declaredName : ctorName || declaredName || "Error",
      message: typeof obj.message === "string" ? obj.message : String(current),
      code: typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode) : undefined,
      status: typeof obj.status === "number" ? obj.status : undefined,
    });
    current = obj.cause;
  }

  if (nodes.length === 0) {
    nodes.push({ name: "Error", message: String(error) });
  }
  return nodes;
}

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***")
    .replace(/((?:api[_-]?key|access[_-]?token|authorization)\s*[=:]\s*)(?:bearer\s+)?[^&\s,;]+/gi, "$1***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1***");
}

function buildDetail(nodes: ErrorNode[]): string {
  const lines: string[] = [];
  const seenMessages = new Set<string>();

  nodes.forEach((node, index) => {
    const parts: string[] = [];
    if (node.name && node.name !== "Error") {
      parts.push(node.name);
    }
    if (node.message.trim()) {
      parts.push(node.message.trim());
    }
    if (node.code) {
      parts.push(`[${node.code}]`);
    }
    if (node.status != null) {
      parts.push(`(HTTP ${node.status})`);
    }
    const line = parts.join(" ").trim();
    if (!line || seenMessages.has(line)) {
      return;
    }
    seenMessages.add(line);
    lines.push(index === 0 ? line : `← ${line}`);
  });

  return redactSecrets(lines.join("\n"));
}

// ─── 分类 ────────────────────────────────────────────────

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA", "EAI_NONAME"]);
const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_IDLE_TIMEOUT",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);
const TLS_CODES = new Set([
  "EPROTO",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
]);
const PROXY_CODES = new Set([
  "ERR_PROXY_CONNECTION_FAILED",
  "ERR_PROXY_AUTH_FAILED",
  "ERR_TUNNEL_CONNECTION_FAILED",
  "ERR_SOCKS_CONNECTION_FAILED",
  "ECONNREFUSED_PROXY",
]);
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENETDOWN",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_RESPONSE_STATUS_CODE",
]);
const NETWORK_TEXT = /connection error|fetch failed|socket hang up|premature close|other side closed|terminated|network|connection reset|connection refused/i;
const EMPTY_TEXT = /empty response|no content|returned no choices/i;
const INCOMPLETE_TEXT = /without a final answer|only returned reasoning/i;
const TLS_TEXT = /certificate|tls|ssl|handshake/i;
const TIMEOUT_TEXT = /timed?\s*out|timeout|deadline exceeded/i;
const CONTEXT_TEXT = /context length|maximum context|too many tokens|token limit|exceeds? the (?:maximum )?context|上下文/i;

function matchCode(codes: Set<string>, node: ErrorNode): boolean {
  return node.code != null && codes.has(node.code.toUpperCase());
}

function extractHttpStatus(nodes: ErrorNode[]): number | undefined {
  const direct = nodes.find((node) => node.status != null)?.status;
  if (direct != null) {
    return direct;
  }
  for (const node of nodes) {
    const match = /(?:^|\D)(\d{3})\s*(?:status|error|:)/i.exec(node.message) ?? /^(?:Error:\s*)?(\d{3})\b/.exec(node.message);
    if (match) {
      const status = Number(match[1]);
      if (status >= 400 && status <= 599) {
        return status;
      }
    }
  }
  return undefined;
}

function classifyStatusCode(status: number, nodes: ErrorNode[]): LlmErrorCode {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 402) {
    return "quota";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 408) {
    return "timeout";
  }
  if (status === 407) {
    return "proxy";
  }
  if (status >= 500) {
    return "server";
  }
  if (status === 400 || status === 413 || status === 422) {
    return nodes.some((node) => CONTEXT_TEXT.test(node.message)) ? "context_length" : "bad_request";
  }
  return "bad_request";
}

function classifyCode(nodes: ErrorNode[]): LlmErrorCode {
  if (nodes.some((node) => node.name === "AbortError" || node.name === "APIUserAbortError" || node.code === "ABORT_ERR")) {
    return "aborted";
  }

  const status = extractHttpStatus(nodes);
  if (status != null) {
    return classifyStatusCode(status, nodes);
  }

  const names = nodes.map((node) => node.name.toLowerCase());
  if (names.includes("apiconnectiontimeouterror")) {
    return "timeout";
  }

  for (const node of nodes) {
    if (matchCode(DNS_CODES, node)) return "dns";
    if (matchCode(TIMEOUT_CODES, node)) return "timeout";
    if (matchCode(PROXY_CODES, node)) return "proxy";
    if (matchCode(TLS_CODES, node)) return "tls";
    if (matchCode(NETWORK_CODES, node)) return "network";
  }

  const messages = nodes.map((node) => node.message);
  if (messages.some((message) => INCOMPLETE_TEXT.test(message))) return "incomplete";
  if (messages.some((message) => EMPTY_TEXT.test(message))) return "empty_response";
  if (messages.some((message) => CONTEXT_TEXT.test(message))) return "context_length";
  if (messages.some((message) => TLS_TEXT.test(message))) return "tls";
  if (messages.some((message) => TIMEOUT_TEXT.test(message))) return "timeout";
  if (messages.some((message) => NETWORK_TEXT.test(message))) return "network";

  if (names.includes("apiconnectionerror")) return "network";
  if (/\b(?:401|invalid api key|unauthorized|incorrect api key)\b/i.test(messages.join(" "))) return "auth";

  return "unknown";
}

/**
 * 判断一个错误是否属于“主动中断”。
 * 会沿 cause 链检查，兼容我们的 LlmStreamFailure 包装。
 */
export function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return collectErrorChain(error).some(
    (node) => node.name === "AbortError" || node.name === "APIUserAbortError" || node.code === "ABORT_ERR"
  );
}
/**
 * 把任意 LLM 请求错误归一化为可展示的结构。
 */
export function classifyLlmError(error: unknown): LlmErrorInfo {
  const nodes = collectErrorChain(error);
  const code = classifyCode(nodes);
  const template = TEMPLATES[code];
  const httpStatus = extractHttpStatus(nodes);

  return {
    code,
    title: template.title,
    message: template.message,
    detail: buildDetail(nodes),
    httpStatus,
    retryable: template.retryable,
  };
}

/** 一行式摘要，用于通知 / 连接测试等场景 */
export function formatLlmErrorText(info: LlmErrorInfo, options?: { includeDetail?: boolean }): string {
  const head = `${info.title}：${info.message}`;
  if (options?.includeDetail && info.detail) {
    return `${head}\n${info.detail}`;
  }
  return head;
}

/** 把重试次数限制在 0–3，非法值回退到 defaultRetries */
export function normalizeRetryCount(value: unknown, defaultRetries = 2): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultRetries;
  }
  return Math.max(0, Math.min(3, Math.trunc(value)));
}

// ─── 流错误包装 ──────────────────────────────────────────

/**
 * 流式请求最终失败时抛出的错误。
 * 携带已输出的部分内容，供会话层落盘，避免用户已看到的内容凭空消失。
 */
export class LlmStreamFailure extends Error {
  readonly info: LlmErrorInfo;
  readonly partialContent: string;
  readonly partialReasoning: string;

  constructor(info: LlmErrorInfo, cause: unknown, partialContent: string, partialReasoning: string) {
    super(`${info.title}: ${info.message}`, { cause });
    this.name = "LlmStreamFailure";
    this.info = info;
    this.partialContent = partialContent;
    this.partialReasoning = partialReasoning;
  }
}

/** 取得结构化错误信息（优先复用 LlmStreamFailure 上的分类结果） */
export function toLlmErrorInfo(error: unknown): LlmErrorInfo {
  if (error instanceof LlmStreamFailure) {
    return error.info;
  }
  return classifyLlmError(error);
}
