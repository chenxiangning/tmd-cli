/**
 * 提交 diff tab 开框桥 —— 编辑器 blame gutter(files/kernel 侧)跨件触发 git
 * 插件的提交 diff 中央 tab。协议同 fileHistoryBridge:git 插件 activate 置 ref
 * 并返回清理;调用方按 null 闸(git 插件未启用时点击静默,深链面不存在)。
 */

/** 打开提交 diff tab 的请求(结构 = git 插件 CommitTabPayload 的非视图字段)。 */
export interface CommitOpenRequest {
  cwd: string;
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  /** unix 秒 */
  authorWhen: number;
}

export const commitOpenRef: {
  current: ((req: CommitOpenRequest) => void) | null;
} = { current: null };
