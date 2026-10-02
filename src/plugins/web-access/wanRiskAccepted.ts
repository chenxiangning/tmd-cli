/**
 * 外网风险确认的 localStorage 读写(自 WebWanRiskDialog.tsx 拆出,
 * only-export-components:组件文件只留组件)。
 */

const STORAGE_KEY = "tmd.webWanRiskAccepted";

export function readWanRiskAccepted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWanRiskAccepted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* localStorage 不可写时等同每次询问 —— 更严,放行 */
  }
}

/** 清除确认标记(设置「安全」区入口):外网 tab 的风险门将重新弹出。 */
export function clearWanRiskAccepted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage 不可写时读侧恒 false(门本就会再现),无需处理 */
  }
}
