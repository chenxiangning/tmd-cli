/**
 * Ask 等待确认守望 —— 检测 PTY 输出中「CLI 阻塞等待用户确认」的界面标记,
 * 维护每会话等待状态(会话列表「等待确认」标签的数据源)。
 *
 * 从 askSound.ts 的第二观察者形态升级而来(见 openspec/changes/add-ask-badge/design.md):
 * 标签是首类 UI 状态而非锦上添花 —— 检测移入 host.appendOutput 主链路,
 * 一次检测两处消费(askDetected 事件 → 提示音;isWaiting → 列表标签),
 * 且天然继承 host 的存活守卫(迟到输出不得复活已删会话的状态)。
 *
 * 检测三件套(与 askSound 世代等价):240 字符原始尾巴跨分片拼接 → 剥 ANSI →
 * 页脚窗口(末 5 行)内跑保守标记正则。等待中的会话跳过匹配(TUI 挂起时仍会
 * 持续重绘推进,输出流不能作为"已不再等待"的信号)。
 *
 * 状态迁移(边沿触发,替代 askSound 旧的时间窗去重):
 * - 置位:未等待时标记命中(false → true,发 askDetected);
 * - 清除:用户写入(作答,尾巴一并重置 —— 新回合从零检测)/ 会话移除。
 * 一个未回答的提问期间无论重绘多少次都只触发一次;作答后的下一个提问再触发。
 */

/** Ask/确认界面标记:保守选词(面板标题/页脚提示字面量),助手正文误报概率极低。
 * omp Ask 面板 / 通用选择与取消页脚 / y-n 提问(含大小写与方括号变体)/
 * claude 权限确认标题句式。扩展新 CLI 只需在此追加。 */
const ASK_MARKER_RE =
  /Ask \d+ questions?|Enter select\b|Esc(?: to)? cancel\b|[([][yY]\/[nN][)\]]|Do you want/;

/** 页脚窗口:标记只认剥 ANSI 后的末 5 行 —— 面板标题+选项区的高度上限。 */
const FOOTER_WINDOW_LINES = 5;

/** ANSI 转义序列(CSI/OSC/单字符)——ansi-regex 同款成熟模式,只剥转义不伤可读文本。 */
const ANSI_RE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)?)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

/** 尾巴长度:覆盖标记短字面量的跨分片窗口,又不至于每 chunk 全量重扫。 */
const RAW_TAIL_CHARS = 240;

/** 剥离 ANSI 转义,只留可读文本用于标记匹配。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** 取剥 ANSI 后文本的页脚窗口(末 5 行)。 */
function footerWindow(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-FOOTER_WINDOW_LINES).join("\n");
}

/** 每会话检测状态:原始尾巴(跨分片拼接)。 */
interface AskTail {
  rawTail: string;
}

export class AskWatch {
  private readonly tails = new Map<string, AskTail>();
  /** 正等待用户确认的会话集合:纯内存态,随 PTY 消亡。 */
  private readonly waiting = new Set<string>();

  /**
   * 会话输出进站(host.appendOutput 唯一调用方)。
   * 返回 true = 本次新进入等待(false → true),host 据此发 askDetected 并重渲染;
   * 已在等待中恒 false(重绘不重复触发,也跳过匹配省热点开销)。
   */
  onOutput(sessionId: string, text: string): boolean {
    if (this.waiting.has(sessionId)) return false;
    const tail = this.tails.get(sessionId) ?? { rawTail: "" };
    const combined = tail.rawTail + text;
    const hit = ASK_MARKER_RE.test(footerWindow(stripAnsi(combined)));
    this.tails.set(
      sessionId,
      combined.length > RAW_TAIL_CHARS
        ? { rawTail: combined.slice(-RAW_TAIL_CHARS) }
        : { rawTail: combined },
    );
    if (!hit) return false;
    this.waiting.add(sessionId);
    this.tails.delete(sessionId);
    return true;
  }

  /**
   * 用户写入(host.writeSession 唯一调用方)= 作答,等待解除。
   * 尾巴一并重置:旧提问字面量不得借写入回显的短 chunk 复燃。
   * 返回 true = 状态实际翻转,host 据此重渲染摘标签。
   */
  onUserWrite(sessionId: string): boolean {
    this.tails.delete(sessionId);
    if (!this.waiting.delete(sessionId)) return false;
    return true;
  }

  /** 会话移除:等待/尾巴残留一并清除。 */
  onSessionRemoved(sessionId: string): void {
    this.tails.delete(sessionId);
    this.waiting.delete(sessionId);
  }

  /** 等待确认判定(会话列表「等待确认」标签)。 */
  isWaiting(sessionId: string): boolean {
    return this.waiting.has(sessionId);
  }

  /** 测试专用:全态归零,防跨用例残留。 */
  resetForTest(): void {
    this.tails.clear();
    this.waiting.clear();
  }
}
