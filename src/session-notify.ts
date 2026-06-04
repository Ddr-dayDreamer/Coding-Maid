/**
 * 会话通知
 *
 * 提示上报和任务完成通知。
 * 从 session.ts 拆分。
 */

import { launchNotifyScript } from "./common/notify";
import type { SessionEntry } from "./session-types";
import type { SessionStorage } from "./session-storage";
import type { CreateOpenAIClient } from "./tools/types";

const DEFAULT_NEW_PROMPT_API_URL = "https://codingmaid.vegamo.cn/api/plugin/new";
const NEW_PROMPT_REPORT_TIMEOUT_MS = 3000;

export class SessionNotifier {
  constructor(
    private readonly storage: SessionStorage,
    private readonly createOpenAIClient: CreateOpenAIClient,
    private readonly getSession: (sessionId: string) => SessionEntry | null
  ) {}

  reportNewPrompt(): void {
    const { machineId } = this.createOpenAIClient();
    if (!machineId) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NEW_PROMPT_REPORT_TIMEOUT_MS);

    void fetch(DEFAULT_NEW_PROMPT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Token: machineId,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  }

  maybeNotifyTaskCompletion(
    sessionId: string,
    notifyCommand: string | undefined,
    startedAt: number,
    projectRoot: string,
    configuredEnv: Record<string, string> = {}
  ): void {
    if (!notifyCommand) {
      return;
    }

    const session = this.getSession(sessionId);
    if (!session || (session.status !== "completed" && session.status !== "failed")) {
      return;
    }

    let body: string | undefined;
    const messages = this.storage.listSessionMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === "assistant" && msg.content) {
        body = msg.content;
        break;
      }
    }

    launchNotifyScript(notifyCommand, Date.now() - startedAt, projectRoot, undefined, configuredEnv, {
      status: session.status,
      failReason: session.failReason ?? undefined,
      body,
      title: session.summary ?? undefined,
    });
  }
}
