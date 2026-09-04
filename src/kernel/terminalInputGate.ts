/**
 * 历史重写输入闸(TerminalView 专用)。
 *
 * 问题:xterm 解析字节流时会对内容里的终端查询序列自动应答 ——
 * DSR `\x1b[6n` → CPR、DA `\x1b[c` → 能力应答、OSC 10/11 颜色查询 → 颜色值,
 * 应答经 `onData` 冒出,与用户击键同一条通道。
 * 幕布回放输出缓冲 / 翻页整段重写历史时,这些历史查询被再次应答,若照走
 * `host.writeSession`:① 陈旧应答作为垃圾输入注入活 PTY;② writeSession
 * 视同用户首写,活动守望首写闸被误开 —— 历史会话点开即走完呼吸灯
 * 绿→蓝生命周期(打开历史会话不得亮灯,见 activityWatch 首写闸语义)。
 *
 * 闸:重写窗口内丢弃一切终端回传(用户尚无可输入目标);窗口外原样放行
 * —— 实时流里的查询应答是 CLI 正在等待的,不可丢。
 * 计数制(arm/release 配对):挂载回放与翻页重写交叠时不互相误放。
 */
interface ReplayInputGate {
  /** 重写历史前调用;末段 write 回调(或异常兜底)里 release。 */
  arm(): void;
  release(): void;
  /** onData 闸:true = 当前回传来自历史重写,丢弃。 */
  blocked(): boolean;
}

export function createReplayInputGate(): ReplayInputGate {
  let depth = 0;
  return {
    arm() {
      depth += 1;
    },
    release() {
      depth = Math.max(0, depth - 1);
    },
    blocked() {
      return depth > 0;
    },
  };
}
