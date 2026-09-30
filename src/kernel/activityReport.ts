/**
 * 活动板上报器 —— 手机「运行中」区投影的桌面发布端。
 * 活动守望(ActivityWatch)是轮次/未读的唯一权威;本件把它的全量快照 300ms 尾沿
 * 去抖上报注册表(session_report_activity → Rust 活动板),手机 session_list 直读。
 * 全量语义无累积漂移;签名去重跳过无变化 IPC;失败 5s 后重取快照重试(桥断连自愈)。
 */
import { ipc } from "./ipc";

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout(activityWatch 同款)。 */
type TimerHandle = ReturnType<typeof setTimeout>;

/** 活动板条目(与 Rust SessionActivity serde camelCase 对齐)。 */
export interface ActivitySnapshotEntry {
  id: string;
  turnActive: boolean;
  unread: boolean;
}

export class ActivityReporter {
  private timer: TimerHandle | null = null;
  private lastPush: string | null = null;

  constructor(private readonly snap: () => ActivitySnapshotEntry[]) {}

  /** 变更加一次队列;300ms 内抖动合一次 IPC,快照未变化跳过。 */
  queue(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const entries = this.snap();
      const sig = JSON.stringify(entries);
      if (sig === this.lastPush) return;
      ipc.sessionReportActivity?.(entries)
        .then(() => { this.lastPush = sig; })
        .catch(() => {
          this.lastPush = null; /* 保持脏:5s 后重取快照重试,成功即停 */
          this.timer = setTimeout(() => { this.timer = null; this.queue(); }, 5_000);
        });
    }, 300) as unknown as TimerHandle;
  }
}
