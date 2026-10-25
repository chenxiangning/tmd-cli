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
 *   - `1049h…1049l` alt 段内容整体丢弃 —— 那是 alt 屏私有画布,真终端退屏即弃;
 *     放行会与紧随的内联重画并排成两份同帧(2026-10-22 目检:拖 composer 每次
 *     resize 堆两份 omp 欢迎屏),与回放面 stripDanceEnvelopes 同律对齐;
 *   - 舞步起点注入 `rows-1` 个换行,把 CLI 的内联重画挤到 transcript 之下的
 *     空白区,帧落在空白上而非覆写可见屏。
 * 这与 TERM 不带 smcup 时 CLI 的降级路径同构 —— 是终端能力声明,不是幕布内
 * 二次渲染;字节流原样透传铁律的唯一例外,例外面仅此四种清屏/换屏序列。
 *
 * 窗口:host.resizeSession 前后 arm(~2.5s);窗口外一切字节原样透传。
 * SSH 会话走独立 io 通道,暂不覆盖(见 sshSessions.ts)。
 *
 * 2026-10-25 修订(扣留待确认):armed 窗内见 1049h 不再立即丢弃 —— 真交互式
 * alt UI(模型选择器/fzf)同样以 1049h 开头且驻留等用户操作,无 1049l 闭合;
 * 立即丢弃会把 picker 帧吞掉并滞留 dance 相丢光后续输出(实证:resize 后 2.5s
 * 窗内点 composer 模型位,omp /model 的 1049h+13KB picker 帧全灭,幕布卡死,
 * 重试数次才恢复)。现改为:1049h 起字节扣留(hold),见 1049l 确认舞步才
 * 丢弃+注换行+剥尾;DANCE_CONFIRM_MS 内 1049l 未至 = 真 alt,hold 原样奉还
 * (emit 出口主动上屏,不依赖后续字节)并 disarm。
 */

const DANCE_HEAD = "\x1b[?1049h";
const DANCE_EXIT = "\x1b[?1049l";
const CLEAR_HOME = "\x1b[H";
const CLEAR_SCREEN = "\x1b[2J";
const CLEAR_SCROLLBACK = "\x1b[3J";
/** 1049l 之后搜寻 3J 签名的字节预算(实测 前奏11B+H4B+2J4B+3J4B=23B;冗余到 32;
 *  预算尽未见 3J = 真 alt,pending 原样奉还)。 */
const TAIL_STRIP_BUDGET = 32;
/** 转义序列最长形态(1049h 8B);块尾疑似半截序列的扣留上限。 */
const MAX_TOKEN = 8;
/** 舞步确认窗:1049h 起 800ms 内未见 1049l = 真 alt UI(实证 omp /model picker
 *  驻留、fzf 常驻),hold 原样奉还。实测舞步(SIGWINCH 响应)亚秒完成,800ms
 *  宽裕 5 倍;误判方向保守:极慢舞步被奉还仅保位失效,真 alt 被吞是幕布卡死。 */
const DANCE_CONFIRM_MS = 800;
/** tail 相停滞上限:CLI 死在尾清屏窗(1049l 后无 3J)时 pending 原样奉还;
 *  dance 相由 DANCE_CONFIRM_MS 覆盖。 */
const DANCE_STALL_MS = 10_000;

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
  /** 实时字节过滤:返回可直接 write 的文本(舞步确认后含起点换行注入)。 */
  feed(chunk: string): string;
  /** 开(或续)过滤窗(host.resizeSession 转发前调用;窗内舞步剥除,窗外透传)。 */
  armUntil(ts: number): void;
  /** 超时奉还出口(terminalStream 装配注入;keep-alive 重挂刷新绑定)。
   *  未注入时退化为 feed 内被动超时(测试/纯守卫装配)。 */
  emit?: (text: string) => void;
  /** 清确认 timer(幕布卸载,releaseSigwinchGuard 代调)。 */
  dispose(): void;
}

export function createSigwinchGuard(rows: () => number): SigwinchGuard {
  let armedUntil = 0;
  let carry = "";
  /* idle → dance(见 1049h,hold 扣留待确认)→ tail(见 1049l,剥尾清屏)→ idle */
  let phase: "idle" | "dance" | "tail" = "idle";
  let tailBudget = 0;
  let tailPending = "";
  let phaseSince = 0;
  /* 舞步扣留段(含 1049h 起):确认(1049l)丢弃+注换行;超时(真 alt)原样奉还。 */
  let hold = "";
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const clearConfirm = (): void => {
    if (confirmTimer !== undefined) {
      clearTimeout(confirmTimer);
      confirmTimer = undefined;
    }
  };

  /** 真 alt 判定:hold 原样奉还、回 idle、清窗(交互态内后续 1049h 不再按舞步扣)。 */
  const releaseHold = (): string => {
    const text = hold;
    hold = "";
    clearConfirm();
    phase = "idle";
    armedUntil = 0;
    return text;
  };

  const guard: SigwinchGuard = {
    armUntil(ts: number): void {
      armedUntil = ts;
    },
    dispose: clearConfirm,
    feed(chunk: string): string {
      /* tail 相停滞自愈:pending 是真实内容,原样奉还(dance 相由确认窗覆盖) */
      let joined = carry + chunk;
      carry = "";
      if (phase === "tail" && Date.now() - phaseSince > DANCE_STALL_MS) {
        joined = tailPending + joined;
        tailPending = "";
        phase = "idle";
      }
      let out = "";
      for (;;) {
        if (phase === "idle") {
          if (Date.now() >= armedUntil) {
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
          out += joined.slice(0, at);
          hold = DANCE_HEAD;
          joined = joined.slice(at + DANCE_HEAD.length);
          phase = "dance";
          phaseSince = Date.now();
          /* 确认窗超时主动出口:picker 静默驻留(无后续字节)也能上屏。
           *  仅 emit 注入时调度;fire 时守卫可能已卸载/换相,双条件复核。 */
          if (guard.emit) {
            clearConfirm();
            confirmTimer = setTimeout(() => {
              if (phase !== "dance") return;
              const text = releaseHold();
              if (text) guard.emit?.(text);
            }, DANCE_CONFIRM_MS);
          }
          continue;
        }
        if (phase === "dance") {
          /* 确认窗尽未见 1049l = 真 alt(模型选择器实证形态):原样奉还,余量重路由 */
          if (Date.now() - phaseSince >= DANCE_CONFIRM_MS) {
            out += releaseHold();
            continue;
          }
          const s = splitCarry(joined);
          carry = s.carry;
          const exit = s.body.indexOf(DANCE_EXIT);
          if (exit < 0) {
            hold += s.body;
            return out;
          }
          /* 舞步确认:alt 段(帧第一拷贝)丢弃 —— 真终端退 alt 即弃,放行会与
           *  紧随的内联重画并排成两份同帧(2026-10-22 目检实证,与回放面
           *  stripDanceEnvelopes 产物对齐);起点注入 rows-1 换行把内联重画
           *  挤到 transcript 之下的空白区,帧落在空白上而非覆写可见屏。 */
          hold = "";
          clearConfirm();
          out += "\r\n".repeat(Math.max(0, rows() - 1));
          phase = "tail";
          phaseSince = Date.now();
          tailBudget = TAIL_STRIP_BUDGET;
          tailPending = "";
          joined = s.body.slice(exit + DANCE_EXIT.length) + s.carry;
          carry = "";
          continue;
        }
        /* tail 相(1049l 已见、舞步已确认):预算内滑窗搜 3J 签名,命中 l..3J
         *  整体剥除(前奏一并弃,hold 段丢弃的 OSC8 开在此闭合);预算尽 =
         *  fzf 退屏/未知形态,pending 原样奉还零损失(先扣块尾半截 token)。 */
        const s = splitCarry(joined);
        carry = s.carry;
        let i = 0;
        let rest: string | undefined;
        while (i < s.body.length) {
          const fromPending = Math.min(tailPending.length, CLEAR_SCROLLBACK.length - 1);
          const fromBody = CLEAR_SCROLLBACK.length - fromPending;
          if (tailPending.slice(-fromPending) + s.body.slice(i, i + fromBody) === CLEAR_SCROLLBACK) {
            i += fromBody;
            tailPending = "";
            phase = "idle";
            rest = s.body.slice(i);
            break;
          }
          tailPending += s.body[i];
          i += 1;
          tailBudget -= 1;
          if (tailBudget <= 0) {
            phase = "idle";
            rest = tailPending + s.body.slice(i);
            tailPending = "";
            break;
          }
        }
        if (rest === undefined) return out;
        joined = carry + rest; /* 已回 idle:余量(含扣留尾)重路由(主循环顶) */
        carry = "";
      }
    },
  };
  return guard;
}


/**
 * 回放面舞步包络剥除(纯函数)。outputBuffer/磁盘 journal 存的是过滤前原始字节,
 * 全量回放(刷新钮/停滞重建/无冻结快照重挂/磁盘尾)会把历史舞步原样重放进
 * xterm —— 3J 清掉刚回放出的滚动缓冲,live 守卫保住的位在回放面上静默清零。
 * 本函数与 live 守卫同律:识别「1049h…帧…1049l + 尾清屏(32B 内含 3J)」整体
 * 包络,整体剥除并在包络起点注入 rows-1 换行(帧落空白区,与 live 产物对齐);
 * vim/fzf 真 alt 的 1049l 后无 3J,原样保留。非包络形态(残缺头/尾)不动。
 */
export function stripDanceEnvelopes(text: string, rows: number): string {
  const envelopes: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (;;) {
    const head = text.indexOf(DANCE_HEAD, from);
    if (head < 0) break;
    const exit = text.indexOf(DANCE_EXIT, head + DANCE_HEAD.length);
    if (exit < 0) break; /* 未闭合舞步(CLI 死在 alt):原样保留,xterm 语义同当时 */
    let i = exit + DANCE_EXIT.length;
    /* 尾清屏窗与 live tail(feedDanceBody)同律:1049l 与 H+2J+3J 之间有前奏
     * (2026-10-22 real_winch.bin:\x1b[0m\x1b]8;;\x07 SGR 复位 + OSC8 闭合,
     *  帧内无超链接时缺省)——预算内滑窗搜 3J 舞步签名,命中整段剥除(前奏一并弃);
     * 未见 = vim/fzf 真 alt 或未知形态,原样保留。 */
    const wipe = text.indexOf(CLEAR_SCROLLBACK, i);
    if (wipe >= 0 && wipe + CLEAR_SCROLLBACK.length <= i + TAIL_STRIP_BUDGET) {
      envelopes.push({ start: head, end: wipe + CLEAR_SCROLLBACK.length });
      from = wipe + CLEAR_SCROLLBACK.length;
    } else {
      from = exit + DANCE_EXIT.length;
    }
  }
  if (envelopes.length === 0) return text;
  const pad = "\r\n".repeat(Math.max(0, rows - 1));
  let out = "";
  let cursor = 0;
  for (const env of envelopes) {
    out += text.slice(cursor, env.start) + pad;
    cursor = env.end;
  }
  return out + text.slice(cursor);
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

/** 幕布卸载时释放登记(防 map 无界生长),顺带清确认 timer 防 fire 写已卸载幕布。 */
export function releaseSigwinchGuard(sessionId: string): void {
  guards.get(sessionId)?.dispose();
  guards.delete(sessionId);
}

/** 生产路径取守卫(已注册即返回;窗口内外的取舍由守卫内部判定 —— 舞步/真 alt
 *  由 DANCE_CONFIRM_MS 扣留确认区分,tail 半截漏过滤由 10s 停滞上限兜底)。 */
export function sigwinchGuardOf(sessionId: string): SigwinchGuard | undefined {
  return guards.get(sessionId);
}
