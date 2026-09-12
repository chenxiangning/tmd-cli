/**
 * 当前挂载 FileTree 的动作句柄注册表 —— 自 FileTree.tsx 拆出
 * (only-export-components):模块级单例槽,FileTree 挂载时上交,
 * 外壳 subbar 的 refresh/newFile/newFolder 按钮据此转发。
 */

interface TreeHandles {
  reload: () => Promise<void>;
  newFile: () => void;
  newFolder: () => void;
}

let activeTreeHandles: TreeHandles | null = null;

/** 注册表槽读口:外壳按钮消费(未挂载 FileTree 时为 null,按钮无操作)。 */
export function getActiveTreeHandles(): TreeHandles | null {
  return activeTreeHandles;
}

/** FileTree 挂载时上交动作句柄;卸载即断开(置 null)。 */
export function setActiveTreeHandles(handles: TreeHandles | null): void {
  activeTreeHandles = handles;
}
