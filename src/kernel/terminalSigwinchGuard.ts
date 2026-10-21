/**
 * SIGWINCH 舞步降级 —— 幕布能力声明:本终端无 alternate screen。
 *
 * 背景(2026-10-21 实测 omp 18.12 / pi 系 TUI 字节流):TUI CLI 收到尺寸变化
 * (SIGWINCH)执行「无闪烁全量重绘」协议:
 *   `\x1b[?1049h` 进 alt 屏 → 画新帧 → `\x1b[?1049l` 退回 → `\x1b[H` + `2J` +
 *   `3J` 清屏并清滚动缓冲 → 内联重画同帧。
 * 代价:`3J` 把滚动缓冲连同用户阅读位一起删掉 —— 大仙报的「点链/开关面板/
 * 关文件后幕布置顶」三触发同源。缓冲被 CLI 亲手清空后,幕布侧任何位置恢复
 * 都是无米之炊,唯一修法在字节进 xterm 之前把舞步降级:
 *   - 剥 `1049h/1049l/2J/3J`(仅舞步窗口内;窗口外 fzf/vim 的 alt 用法原样放行);
 *   - 舞步起点注入 `rows-1` 个换行,把 CLI 的内联重画挤到 transcript 之下的
 *     空白区,帧落在空白上而非覆写可见屏。
 * 这与 TERM 不带 smcup 时 CLI 的降级路径同构 —— 是终端能力声明,不是幕布内
 * 二次渲染;字节流原样透传铁律的唯一例外,例外面仅此四种清屏/换屏序列。
 *
 * 窗口:host.resizeSession 前后 arm(~2.5s);窗口外一切字节原样透传。
 * SSH 会话走独立 io 通道,暂不覆盖(见 sshSessions.ts)。
 */

const DANCE_HEAD = "\x1b[?1049h";
const DANCE_EXIT = "\x1b[?1049l";
const CLEAR_HOME = "\x1b[H";
const CLEAR_SCREEN = "\x1b[2J";
const CLEAR_SCROLLBACK = "\x1b[3J";
/** 1049l 之后允许被剥的尾清屏字节上限(实测 H+2J+3J ≈ 12B;2 倍冗余)。 */
const TAIL_STRIP_BUDGET = 32;
/** 转义序列最长形态(1049h 8B);块尾疑似半截序列的扣留上限。 */
const MAX_TOKEN = 8;

const TOKENS = [DANCE_HEAD, DANCE_EXIT, CLEAR_HOME, CLEAR_SCREEN, CLEAR_SCROLLBACK] as const;

/** 疑似半截转义扣留:块尾若与任一 token 前缀重合则扣到下一块。 */
function splitCarry(chunk: string): { body: string; carry: string } {
  const start = Math.max(0, chunk.length - MAX_TOKEN);
  for (let i = start; i < chunk.length; i++) {
    for (const t of TOKENS) {
      if (t.startsWith(chunk.slice(i)) && chunk.slice(i).length < t.length) {
        return { body: chunk.slice(0, i), carry: chunk.slice(i) };
      }
    }
  }
  return { body: chunk, carry: "" };
}

export interface SigwinchGuard {
  /** 实时字节过滤:返回可直接 write 的文本(含舞步起点换行注入)。 */
  feed(chunk: string): string;
  /** 开(或续)过滤窗(host.resizeSession 转发前调用;窗内舞步剥除,窗外透传)。 */
  armUntil(ts: number): void;
}

export function createSigwinchGuard(rows: () => number): SigwinchGuard {
  let armedUntil = 0;
  let carry = "";
  /* idle → dance(见 1049h)→ tail(见 1049l,剥尾清屏)→ idle */
  let phase: "idle" | "dance" | "tail" = "idle";
  let tailBudget = 0;

  const isArmed = (): boolean => Date.now() < armedUntil;

  /** 舞步相(dance/tail)处理一段完整字节:返回 out 与未消费余量。
   *  余量非空 = tail 相遇到非清屏 token,已回 idle,余量交回主循环再路由。 */
  const feedDanceBody = (body: string): { out: string; rest?: string } => {
    let out = "";
    let i = 0;
    while (i < body.length) {
      if (phase === "tail") {
        /* 尾清屏窗:只认 H/2J/3J,其余任何字节回 idle 放行 */
        if (body.startsWith(CLEAR_HOME, i)) {
          i += CLEAR_HOME.length;
          tailBudget -= CLEAR_HOME.length;
        } else if (body.startsWith(CLEAR_SCREEN, i)) {
          i += CLEAR_SCREEN.length;
          tailBudget -= CLEAR_SCREEN.length;
        } else if (body.startsWith(CLEAR_SCROLLBACK, i)) {
          i += CLEAR_SCROLLBACK.length;
          tailBudget -= CLEAR_SCROLLBACK.length;
        } else {
          phase = "idle";
          return { out, rest: body.slice(i) };
        }
        if (tailBudget <= 0) phase = "idle";
        continue;
      }
      /* dance 主相:剥换屏/清屏 token;其余(帧内容、光标移动)放行 */
      if (body.startsWith(DANCE_EXIT, i)) {
        phase = "tail";
        tailBudget = TAIL_STRIP_BUDGET;
        i += DANCE_EXIT.length;
        continue;
      }
      if (body.startsWith(CLEAR_SCREEN, i) || body.startsWith(CLEAR_SCROLLBACK, i)) {
        i += CLEAR_SCREEN.length;
        continue;
      }
      if (body.startsWith(DANCE_HEAD, i)) {
        i += DANCE_HEAD.length; /* 重入舞步(连发 resize):只剥不再注入 */
        continue;
      }
      out += body[i];
      i += 1;
    }
    return { out };
  };

  return {
    armUntil(ts: number): void {
      armedUntil = ts;
    },
    feed(chunk: string): string {
      let joined = carry + chunk;
      carry = "";
      let out = "";
      for (;;) {
        if (phase === "idle") {
          if (!isArmed()) {
            const s = splitCarry(joined);
            carry = s.carry;
            return out + s.body;
          }
          const at = joined.indexOf(DANCE_HEAD);
          if (at < 0) {
            const s = splitCarry(joined);
            carry = s.carry;
            return out + s.body;
          }
          out += joined.slice(0, at) + "\r\n".repeat(Math.max(0, rows() - 1));
          joined = joined.slice(at + DANCE_HEAD.length);
          phase = "dance";
          continue;
        }
        /* dance/tail:先扣留块尾半截 token 再进相处理 */
        const s = splitCarry(joined);
        carry = s.carry;
        const r = feedDanceBody(s.body);
        out += r.out;
        if (r.rest === undefined) return out;
        joined = r.rest; /* 已回 idle:余量重路由(主循环顶) */
      }
    },
  };
}

/* —— 每会话登记(terminalStream 挂载时注册真实实例;host.resizeSession arm)—— */
const guards = new Map<string, SigwinchGuard>();

/** 幕布装配时注册会话守卫(rows 取自真实 term;每幕布一实例,随 keep-alive)。 */
export function registerSigwinchGuard(sessionId: string, guard: SigwinchGuard): void {
  guards.set(sessionId, guard);
}

/** 尺寸变化时调用:开(或续)舞步过滤窗;幕布未装配则无处可滤,no-op。 */
export function armSigwinchGuard(sessionId: string, windowMs = 2500): void {
  guards.get(sessionId)?.armUntil(Date.now() + windowMs);
}

/** 幕布卸载时释放登记,防 map 无界生长。 */
export function releaseSigwinchGuard(sessionId: string): void {
  guards.delete(sessionId);
}

/** 生产路径取守卫(已注册即返回;窗口内外的取舍由守卫内部判定 —— 舞步中途
 *  过期也必须续完,否则 l/2J/3J 半截漏过照样清缓冲)。 */
export function sigwinchGuardOf(sessionId: string): SigwinchGuard | undefined {
  return guards.get(sessionId);
}
