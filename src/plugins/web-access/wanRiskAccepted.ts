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
