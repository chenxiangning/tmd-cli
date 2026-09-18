/**
 * 终端回链提供者 —— 幕布里 `path:Lx-Ly` / `path:line` 点击 → 打开文件 tab 并定位锚点。
 * 识别端 parseMarkRef 与发送端 serializeMark 同文件(sendTransform.ts),格式必须同步改。
 * 幕布外增强:只做打开+滚动,零 PTY 字节触碰;解析失败静默(不弹错)。
 */

import { normalizePath } from "@kernel/pathUtils";
import { openFileAtLine } from "@kernel/fileTabs";
import type { TerminalLinkProvider } from "@kernel/terminalLinks";
import { getActiveWorkspace } from "@kernel/workspace";
import { requestReveal } from "./store";
import { parseMarkRef } from "./sendTransform";

/** 绝对路径判定:POSIX /、Windows 盘符(C:/ C:\)、UNC(\\server\share)。 */
const ABS_PATH_RE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

/** 打开文件 tab(kernel 深链统一入口,含光标定位)并请求编辑器扩展闪烁定位。 */
export function openAndReveal(absPath: string, line: number): void {
  openFileAtLine(absPath, line);
  requestReveal(normalizePath(absPath), line);
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
    const abs = ABS_PATH_RE.test(ref.path) ? ref.path : `${root}/${ref.path}`;
    openAndReveal(abs, ref.startLine);
  },
};
