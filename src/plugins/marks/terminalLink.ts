/**
 * 终端回链提供者 —— 幕布里 `path:Lx-Ly` / `path:line` 点击 → 打开文件 tab 并定位锚点。
 * 识别端 parseMarkRef 与发送端 serializeMark 同文件(sendTransform.ts),格式必须同步改。
 * 幕布外增强:只做打开+滚动,零 PTY 字节触碰;解析失败静默(不弹错)。
 */

import { baseName } from "@kernel/pathUtils";
import { openTab } from "@kernel/tabs";
import type { TerminalLinkProvider } from "@kernel/terminalLinks";
import { getActiveWorkspace } from "@kernel/workspace";
import { requestReveal } from "./store";
import { parseMarkRef } from "./sendTransform";

/** 打开文件 tab(既有 tabs 约定 id)并请求编辑器扩展滚动到行。 */
export function openAndReveal(absPath: string, line: number): void {
  openTab(
    {
      id: `file:${absPath}`,
      kind: "file",
      title: baseName(absPath) || absPath,
      path: absPath,
      payload: { path: absPath },
    },
    { refresh: true },
  );
  requestReveal(absPath, line);
}

export const marksLinkProvider: TerminalLinkProvider = {
  id: "marks.backlink",
  find(lineText) {
    return parseMarkRef(lineText);
  },
  open(hit, lineText) {
    const ref = parseMarkRef(lineText.slice(hit.start, hit.end))[0];
    const root = getActiveWorkspace()?.root;
    if (!ref || !root) return;
    const abs = ref.path.startsWith("/") ? ref.path : `${root}/${ref.path}`;
    openAndReveal(abs, ref.startLine);
  },
};
