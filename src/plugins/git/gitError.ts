/**
 * git 错误分类 —— 匹配 kernel/ipc.ts 注释的 E_* 前缀契约。
 * Tauri Err(String) 到前端是 Error(message) 或裸 string,统一归一化。
 */

export function gitErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isNotARepo(e: unknown): boolean {
  return gitErrorMessage(e).startsWith("E_NOT_A_REPO:");
}

export function isAuth(e: unknown): boolean {
  return gitErrorMessage(e).startsWith("E_AUTH:");
}

/** 展示文案:剥掉 E_* 前缀,保留后端原始描述。 */
export function gitErrorDisplay(e: unknown): string {
  return gitErrorMessage(e).replace(/^E_[A-Z_]+:\s*/, "");
}
