/**
 * 历史重写输入闸(TerminalView 专用)。
 *
 * 问题:xterm 解析字节流时会对内容里的终端查询序列自动应答 ——
 * DSR `\x1b[6n` → CPR、DA `\x1b[c` → 能力应答、OSC 10/11 颜色查询 → 颜色值,
 * 应答经 `onData` 冒出,与用户击键同一条通道。
 *
 * 闸窗(arm/release 计数制,可交叠;挂载启动窗与回放/翻页重写窗共用同一计数):
 * 窗内只放行整段终端协议回传(isTerminalReport 整段匹配),其余全弃。
 *
 * 为什么回传必须放行(含回放窗):查询的应答是远端正在死等的数据,丢弃 = 会话
 * 挂死。两轮真机实证:ssh exec wsl.exe 启动链发 `\x1b[6n` 后死等 CPR(2026-09-11);
 * 首修只放行启动 live 窗仍白屏 —— 局域网下连接常先于幕布挂载完成,CPR 落进输出
 * 缓冲走回放分支,回放窗照吞(00:45 会话日志 CPR-only + live PTY 诊断补应答即
 * 出画面,2026-09-12)。放行的代价是回放历史查询时的陈旧重答:一小段合成转义
 * 序列进活 PTY,各 TUI 解析器按未知 CSI 丢弃,远小于挂死;synthetic 标记
 * (writeSession 第三参)保证重答不误开活动守望、不锚定对话。
 * 拆碎的应答片段(pi-tui StdinBuffer 50ms flush 把前缀与终结字节拆成两段
 * data 事件,2026-09-10 win omp-cli 实证)不匹配整段形态,照弃 —— 组合进
 * 对话框注入的老问题不回归。
 */
export interface ReplayInputGate {
  /** 闸窗开:挂载(启动窗)与回放/翻页重写前调用;末段 write 回调(或异常兜底)里 release。 */
  arm(): void;
  release(): void;
  /** onData 闸:true = 窗内(应只放行终端协议回传,判定在消费方与 isTerminalReport 合议)。 */
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
