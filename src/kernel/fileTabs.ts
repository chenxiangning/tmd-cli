/**
 * 文件 tab 深链统一入口(kernel 契约)—— 树点击、快开/搜索命中、git diff、
 * marks 终端回链共用。原 files/openFile.ts 上移:多个插件(files/search/marks/git)
 * 需要同一深链,插件间零直接依赖,契约收敛 kernel。
 *
 * id/path 一律 normalizePath 后派生:Windows 下树点击(原生 `\`)与搜索/快开
 * 拼路径(`/`)不再产生同文件双 tab;fileRevealLines 的键同源对齐。
 */

import { openTab } from "@kernel/tabs";
import { baseName, normalizePath } from "@kernel/pathUtils";

export function openFileInTab(path: string): void {
  const p = normalizePath(path);
  openTab({
    id: `file:${p}`,
    kind: "file",
    title: baseName(p) || p,
    path: p,
    payload: { path: p },
  });
}

/** 待定位行(归一路径 → 行号):写入方 openFileAtLine,消费方 FileTabContent。 */
const fileRevealLines = new Map<string, number>();

/** 打开文件并定位到某行(1 基)。已开 tab 用 refresh 刷新 payload(深链重开语义)。 */
export function openFileAtLine(path: string, line: number): void {
  const p = normalizePath(path);
  fileRevealLines.set(p, line);
  openTab(
    {
      id: `file:${p}`,
      kind: "file",
      title: baseName(p) || p,
      path: p,
      payload: { path: p },
    },
    { refresh: true },
  );
}

/** 一次性消费该文件的定位行;无待定位返回 null。 */
export function takeFileRevealLine(path: string): number | null {
  const line = fileRevealLines.get(path);
  if (line === undefined) return null;
  fileRevealLines.delete(path);
  return line;
}
