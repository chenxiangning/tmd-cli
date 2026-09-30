/**
 * 逐级建目录原语 —— fs_create_dir 非递归,插件写链的公共前置(dsh
 * adapterDeploy / memory-coordinator / daily-journal 各自手抄版,2026-09-30 收口)。
 * 每级「已存在」报错忽略;其余失败也忽略 —— 紧随其后的文件写入会自然暴露真实错误
 * (调用方 catch 兜底提示,与既有先例同一契约)。
 */
import { ipc } from "./ipc";

/** 逐级确保目录存在。绝对路径从根起逐级建;相对路径从首段起建(不拼盘符根)。 */
export async function ensureDir(path: string): Promise<void> {
  const absolute = path.startsWith("/");
  let cur = "";
  for (const seg of path.split("/")) {
    if (!seg) continue;
    cur = `${cur}/${seg}`;
    await ipc.fsCreateDir(absolute ? cur : cur.slice(1)).catch(() => undefined);
  }
}

/** 写文件前确保父目录存在;无父目录(根或裸文件名)时为空操作。 */
export async function ensureParentDir(filePath: string): Promise<void> {
  const cut = filePath.lastIndexOf("/");
  if (cut > 0) await ensureDir(filePath.slice(0, cut));
}
