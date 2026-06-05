/**
 * 扩展入口
 *
 * 职责仅限 activate/deactivate 和 VS Code 生命周期绑定。
 * 所有业务逻辑委托给 CodingMaidViewProvider。
 */

import * as vscode from "vscode";
import { CodingMaidViewProvider } from "./webview/provider";
import { setShellIfWindows } from "./utils/shell-utils";

export function activate(context: vscode.ExtensionContext): void {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";

  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(message);
  }

  const provider = new CodingMaidViewProvider(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(CodingMaidViewProvider.viewType, provider),
    vscode.commands.registerCommand("codingmaid.openView", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.codingmaid");
      await vscode.commands.executeCommand("codingmaid.chatView.focus");
    }),
  );
}

export function deactivate(): void {
  // no-op
}
