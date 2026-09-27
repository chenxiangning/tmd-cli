/**
 * 接力开框桥 —— app-shell(异常退出卡)跨面触发 session-relay 对话框的入口。
 * 协议同 terminalCopyMenuBridge:插件 activate 置 relayOpenRef.current 并返回
 * 清理(停用/熔断经贡献回滚置 null);调用方按 null 闸:桥不在 = 接力插件未
 * 启用,不给按钮 —— app-shell 不 import 插件内部 store。
 */

/** 退出卡能提供的接力源信息(快照,进程已逝;model 不可知不假造)。 */
export interface RelayOpenDetail {
  profileId: string;
  /** profile 展示名(调用方解析后传入;插件零二次查找)。 */
  engineName: string;
  cliSessionId?: string;
  title?: string;
  cwd?: string;
  workspaceId?: string;
}

export const relayOpenRef: { current: ((detail: RelayOpenDetail) => void) | null } = {
  current: null,
};
