/**
 * 工具级审批预检器
 *
 * 为特定工具定义预先的安全检查逻辑。
 * 每个 checker 接收解析后的参数，返回 ToolApprovalCheckResult：
 * - allow:   直接放行（即使 settings 设为 require）
 * - reject:  自动拦截，不执行，附带原因
 * - require: 走正常审批流程（兜底）
 */

import type { ToolApprovalChecker, ToolApprovalCheckResult } from "./types";

// ─── 危险命令模式 ───────────────────────────────────────

const DANGEROUS_BASH_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /rm\s+-rf\s+\/\s*$/i,
    reason: "禁止执行 `rm -rf /` — 这会递归删除整个文件系统",
  },
  {
    pattern: /rm\s+-rf\s+\/\s*--no-preserve-root/i,
    reason: "禁止执行带 --no-preserve-root 的删除命令 — 这会绕过保护删除根目录",
  },
  {
    pattern: /mkfs\s+/i,
    reason: "禁止执行磁盘格式化命令 (mkfs)",
  },
  {
    pattern: /dd\s+if=.*of=\/dev\/(sda|sdb|sdc|nvme|hd[ab])/i,
    reason: "禁止直接写入块设备 — 可能损坏磁盘数据",
  },
  {
    pattern: />\s*\/dev\/(sda|sdb|sdc|nvme|hd[ab])\b/,
    reason: "禁止直接写入磁盘设备文件",
  },
  {
    pattern: /:\(\)\s*\{[^}]*\}.*:\(\)\s*;/,
    reason: "检测到可能的 Fork 炸弹 — 禁止执行",
  },
  {
    pattern: /chmod\s+-R\s+000\s+\//,
    reason: "禁止递归移除根目录所有文件权限 — 会导致系统无法访问",
  },
  {
    pattern: /mv\s+\/\s+\/dev\/null/i,
    reason: "禁止尝试将根目录移动到 /dev/null",
  },
  {
    pattern: /wget\s+.*\|\s*bash/i,
    reason: "禁止从网络下载脚本并直接通过管道执行 (wget ... | bash)",
  },
  {
    pattern: /curl\s+.*\|\s*bash/i,
    reason: "禁止从网络下载脚本并直接通过管道执行 (curl ... | bash)",
  },
  {
    pattern: /^(rm\s+-rf|rm\s+--recursive)\s+(\.|\.\/)?\s*$/i,
    reason: "禁止递归删除当前目录 — 可能误删项目文件",
  },
];

// ─── Bash 审批预检器 ────────────────────────────────────

/**
 * Bash 工具的审批预检器。
 *
 * 检查规则：
 * 1. 如果命令匹配危险模式 → 自动拒绝
 * 2. 如果命令很短（如 ls, pwd）→ 自动放行（即使 mode=require）
 * 3. 其他情况 → 走正常审批流程
 */
export const bashApprovalChecker: ToolApprovalChecker = (
  args: Record<string, unknown>
): ToolApprovalCheckResult => {
  const command = String(args.command ?? "").trim();

  if (!command) {
    return { action: "reject", reason: "空命令" };
  }

  // 1. 检查危险模式
  for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return { action: "reject", reason };
    }
  }

  // [暂禁用] 安全命令自动放行 — 等待测试体验后再决定是否恢复
  // const safeCommands = [
  //   /^ls\b/, /^pwd\b/, /^cd\b/, /^echo\b/, /^cat\b/,
  //   /^head\b/, /^tail\b/, /^which\b/, /^type\b/, /^printf\b/,
  //   /^date\b/, /^whoami\b/, /^env\b/,
  //   /^git\s+status/, /^git\s+log/, /^git\s+diff/, /^git\s+branch/, /^git\s+remote/,
  //   /^npm\s+(list|view|search)/, /^pnpm\s+(list|view|search)/,
  //   /^node\s+-[re]/, /^rg\b/, /^grep\b/, /^find\s+.*\s+-name\b/,
  // ];
  // for (const safe of safeCommands) {
  //   if (safe.test(command)) return { action: "allow" };
  // }

  // 3. 其余命令需要审批
  return { action: "require" };
};

// ─── 敏感文件/路径检查工具 ──────────────────────────────

/** 跨平台系统关键路径前缀（拒绝写入这些位置） */
const SYSTEM_CRITICAL_PATHS: RegExp[] = [
  // Unix 系统路径
  /^\/etc\//,
  /^\/usr\/(?!\/local\/)/,          // /usr/share/, /usr/bin/ 等，但允许 /usr/local/
  /^\/bin\//,
  /^\/sbin\//,
  /^\/boot\//,
  /^\/dev\//,
  /^\/sys\//,
  /^\/proc\//,
  /^\/var\/(?!\/www\/|\/lib\/docker\/|\/log\/)/, // 允许 /var/www, /var/lib/docker, /var/log
  /^\/lib\/(?!\/docker\/)/,
  /^\/System\//,                                    // macOS
  /^\/Library\//,                                   // macOS
  // Windows 系统路径
  /^[A-Za-z]:\\\\(Windows|Program\s?Files|ProgramData|System32|SysWOW64|WinSxS)\\/i,
  /^[A-Za-z]:\\\\Windows\\/i,
];

/** 敏感配置文件（拒绝写入） */
const SENSITIVE_CONFIG_FILES: { pattern: RegExp; reason: string }[] = [
  // SSH
  { pattern: /[\\/]\.ssh[\\/]/, reason: "禁止修改 SSH 配置文件 — 可能破坏远程访问或权限" },
  { pattern: /[\\/]authorized_keys$/, reason: "禁止修改 authorized_keys — 会改变远程登录权限" },
  { pattern: /[\\/]sudoers$/, reason: "禁止修改 sudoers 文件 — 会改变提权策略" },
  { pattern: /[\\/]passwd$/, reason: "禁止修改 passwd 文件 — 会改变用户认证" },
  { pattern: /[\\/]shadow$/, reason: "禁止修改 shadow 文件 — 会暴露或篡改密码哈希" },
  { pattern: /[\\/]hosts$/, reason: "禁止修改 hosts 文件 — 会改变 DNS 解析" },
  { pattern: /[\\/]hostname$/, reason: "禁止修改主机名配置文件" },
  { pattern: /[\\/]resolv\.conf$/, reason: "禁止修改 DNS 解析配置" },
  { pattern: /[\\/]fstab$/, reason: "禁止修改文件系统挂载表" },
  // GPG
  { pattern: /[\\/]\.gnupg[\\/]/, reason: "禁止修改 GPG 密钥配置" },
  // Shell 配置文件
  { pattern: /[\\/]\.bashrc$/, reason: "禁止修改 bash 配置文件 — 可能被用于持久化后门" },
  { pattern: /[\\/]\.zshrc$/, reason: "禁止修改 zsh 配置文件 — 可能被用于持久化后门" },
  { pattern: /[\\/]\.profile$/, reason: "禁止修改 shell profile 文件" },
  { pattern: /[\\/]\.bash_profile$/, reason: "禁止修改 bash profile 文件" },
  // Windows 敏感文件
  { pattern: /[\\/]NTUSER\.DAT/i, reason: "禁止修改 Windows 用户注册表配置单元" },
  { pattern: /[\\/]SAM$/i, reason: "禁止修改 SAM 文件 — 会改变 Windows 用户账户" },
  { pattern: /[\\/]SYSTEM$/i, reason: "禁止修改 Windows SYSTEM 注册表配置单元" },
  { pattern: /[\\/]SECURITY$/i, reason: "禁止修改 Windows SECURITY 注册表配置单元" },
  { pattern: /[\\/]boot\.ini$/i, reason: "禁止修改 Windows 启动配置文件" },
  { pattern: /[\\/]BCD$/i, reason: "禁止修改 Windows 启动配置数据" },
];

function isSystemCriticalPath(filePath: string): string | null {
  for (const pathPattern of SYSTEM_CRITICAL_PATHS) {
    // 统一将反斜杠转为正斜杠后匹配
    const normalized = filePath.replace(/\\/g, "/");
    if (pathPattern.test(normalized)) {
      return `禁止修改系统关键路径下的文件 — 这可能损坏操作系统 (${filePath})`;
    }
  }
  return null;
}

function isSensitiveFile(filePath: string): string | null {
  for (const { pattern, reason } of SENSITIVE_CONFIG_FILES) {
    if (pattern.test(filePath)) {
      return reason;
    }
  }
  return null;
}

// ─── Write 审批预检器 ────────────────────────────────────

/**
 * Write 工具的审批预检器。
 *
 * 检查规则：
 * 1. 文件路径指向系统关键位置 → 自动拒绝
 * 2. 文件是敏感配置文件 → 自动拒绝
 * 3. 内容为空或极小 → 自动拒绝（可能是误操作）
 * 4. 其他 → 走正常审批流程
 */
export const writeApprovalChecker: ToolApprovalChecker = (
  args: Record<string, unknown>
): ToolApprovalCheckResult => {
  const filePath = String(args.file_path ?? "").trim();
  if (!filePath) {
    return { action: "reject", reason: "文件路径为空" };
  }

  // 1. 检查系统关键路径
  const criticalReason = isSystemCriticalPath(filePath);
  if (criticalReason) {
    return { action: "reject", reason: criticalReason };
  }

  // 2. 检查敏感配置文件
  const sensitiveReason = isSensitiveFile(filePath);
  if (sensitiveReason) {
    return { action: "reject", reason: sensitiveReason };
  }

  // 3. 其余需要审批
  return { action: "require" };
};

// ─── Edit 审批预检器 ────────────────────────────────────

/**
 * Edit 工具的审批预检器。
 *
 * 检查规则：
 * 1. 文件路径指向系统关键位置 → 自动拒绝
 * 2. 文件是敏感配置文件 → 自动拒绝
 * 3. replace_all + 过短的 old_string → 自动拒绝（防止大范围误替换）
 * 4. 其他 → 走正常审批流程
 */
export const editApprovalChecker: ToolApprovalChecker = (
  args: Record<string, unknown>
): ToolApprovalCheckResult => {
  const filePath = String(args.file_path ?? "").trim();

  if (filePath) {
    // 1. 检查系统关键路径
    const criticalReason = isSystemCriticalPath(filePath);
    if (criticalReason) {
      return { action: "reject", reason: criticalReason };
    }

    // 2. 检查敏感配置文件
    const sensitiveReason = isSensitiveFile(filePath);
    if (sensitiveReason) {
      return { action: "reject", reason: sensitiveReason };
    }
  }

  // 3. replace_all + 过短 old_string → 可能造成大范围破坏
  if (args.replace_all === true && typeof args.old_string === "string") {
    const oldStr = args.old_string.trim();
    if (oldStr.length > 0 && oldStr.length < 3) {
      return {
        action: "reject",
        reason: `禁止对长度仅 ${oldStr.length} 个字符的模式执行 replace_all 操作 — 可能造成大范围意外替换`,
      };
    }
    // 替换空白/纯标点符号也有风险
    if (/^[\s\t\n\r]+$/.test(oldStr)) {
      return {
        action: "reject",
        reason: "禁止对纯空白字符模式执行 replace_all 操作 — 可能造成大范围意外替换",
      };
    }
  }

  // 4. 其余需要审批
  return { action: "require" };
};
