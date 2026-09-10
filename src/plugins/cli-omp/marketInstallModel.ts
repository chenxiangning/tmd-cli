/**
 * omp 扩展装卸执行 —— 事件流 id 与命令通道装卸(目录卡与已装行共用)。
 * 自 marketCards.tsx 拆出(only-export-components):组件留在原 tsx。
 */

import { ipc, onCliInstallEvent } from "@kernel/ipc";

/** 装卸事件流 id:omp-ext-<pkg 的逐字节 hex>。Tauri 事件名仅允许字母数字与
 * `- / : _`,scoped 包名的 `@` 违禁且 emit 静默失败(前端永远收不到完成事件,
 * 按钮永转);整体 hex 保证一一对应,免字符歧义。 */
export function installId(name: string): string {
  const hex = [...new TextEncoder().encode(name)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `omp-ext-${hex}`;
}

/** 卡片/已装行共用的装卸执行:流式日志 + 完成/失败落一行,返回是否成功。 */
export async function runPluginAction(
  name: string,
  kind: "install" | "uninstall",
  onLine: (text: string) => void,
): Promise<boolean> {
  /* 先订阅再发命令:tauri listen 异步注册,悬空退订会漏卸订或漏早期日志。 */
  const unlisten = await onCliInstallEvent(installId(name), (e) => onLine(e.text));
  try {
    const ok = await ipc.cliInstallRun(installId(name), {
      channel: "command",
      program: "omp",
      args:
        kind === "install"
          ? ["plugin", "install", name]
          : ["plugin", "uninstall", name],
    });
    return ok;
  } finally {
    unlisten();
  }
}
