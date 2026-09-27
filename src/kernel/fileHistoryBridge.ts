/**
 * 文件历史 tab 开框桥 —— files(文件详情右键/命令)跨件触发 git 插件的
 * 「文件历史 / Git Blame」中央 tab。协议同 relayBridge / terminalCopyMenuBridge:
 * git 插件 activate 置 ref 并返回清理(停用/熔断经贡献回滚置 null);调用方按
 * null 闸:桥不在 = git 插件未启用,不出菜单项。
 */

/** 开文件历史 tab 的请求(cwd + 仓库相对路径,git ipc 口径)。 */
export interface FileHistoryOpenRequest {
  /** 仓库根(工作区 root)。 */
  cwd: string;
  /** 仓库相对路径(git ipc 口径)。 */
  path: string;
}

export const fileHistoryOpenRef: {
  current: ((req: FileHistoryOpenRequest) => void) | null;
} = { current: null };
