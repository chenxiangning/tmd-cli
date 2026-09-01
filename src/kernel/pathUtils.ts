/**
 * 路径工具 —— 统一路径分隔符处理(Windows `\` 与 POSIX `/` 混用)。
 * 此前 basename/工作区名派生散在四处且分隔符不一致(有的只切 `/`,
 * Windows 路径下取错末段),此处收敛为唯一实现。
 */

/** 统一分隔符:`\` → `/`,并去掉尾部分隔符(根路径 "/" 除外)。 */
export function normalizePath(p: string): string {
  const unified = p.replace(/\\/g, "/");
  if (unified === "/") return unified;
  return unified.replace(/\/+$/, "");
}

/** 取路径末段(两种分隔符通吃,尾部分隔符忽略)。空末段时回退原路径。 */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 工作区显示名 = 根目录末段。 */
export function deriveWorkspaceName(root: string): string {
  return baseName(root);
}

/**
 * 路径相等判定:先归一分隔符与尾部分隔符,再按需忽略大小写。
 * macOS/Windows 默认文件系统大小写不敏感,传 caseInsensitive=true 避免漏配。
 */
export function pathsEqual(a: string, b: string, caseInsensitive: boolean): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return caseInsensitive
    ? na.toLowerCase() === nb.toLowerCase()
    : na === nb;
}
