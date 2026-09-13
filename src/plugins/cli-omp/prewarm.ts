/**
 * omp 打开历史会话的预热接管 —— cli-omp 个性化能力(实测数据与机制调研见
 * docs/research/omp-session-open-performance.md:冷启动 3.6-4.0s,其中扩展加载
 * loadExtensions 独占 ~2.7s;TUI 内 /resume 热切换 0.24s 小会话 / 1.2s 大会话)。
 *
 * 机制:后台预热一个裸 omp(扩展后台加载完成后待命),打开磁盘历史会话时经
 * profile.acquireResume 接管 —— 注入 "/resume <id>" 触发 TUI 内 switchSession。
 * 实测约束(omp v18.1.19 真机结论;版本升级后特征失配即熔断降级,不劣于现状):
 * - 注入须「整行(不含回车)→ ~150ms → 单发 \r」:整段一次写入命中 pi-tui
 *   粘贴爆发启发式,回车不提交(与 profile.bracketedPaste 声明同源);
 * - 热切换成功特征 = 屏幕文本 "Resumed session";
 * - 跨 cwd 桶切换被 omp cwd policy 拒绝(File not found)→ 池按 cwd 精确匹配;
 * - 裸启动会落一个空会话文件(列表污染)→ 出生快照 diff + 空校验后删除;
 * - TUI 忽略 SIGTERM,回收必须 sessionKill(强杀);
 * - 切换不建新文件、不写目标文件,磁盘身份稳定(bindIdentity 零扰动)。
 *
 * 资源:单个预热进程 RSS 实测 ~700-810MB;10 分钟未消费自动回收。
 * 降级闭环:池空 / cwd 不匹配 / 未就绪 / 进程死亡 / 特征熔断 → 返回 null,
 * sessionSpawn 走默认冷路径。特征超时熔断(本运行周期不再预热)是关键护栏:
 * 若 omp 升级改变了切换语义,否则每次打开历史都先白等注入超时再冷启动。
 */

import { ipc } from "@kernel/ipc";
import { onPtyExit, onPtyOutput } from "@kernel/ipc";
import {
  markShadowSession,
  restoreShadowSessions,
  unmarkShadowSession,
} from "@kernel/sessionShadowing";
import { ompSessionsDir } from "./edits";
import { lockAndRemoveBirthFile, pickPrewarmCwd } from "./prewarmFs";

/** spawn 后就绪等待:覆盖裸启动首屏 0.6s + 扩展后台加载 ~4.5s(实测)。 */
const READY_DELAY_MS = 6_000;
/** 命令与回车的间隔:规避 pi-tui 粘贴爆发启发式(实测 150ms 稳定提交)。 */
const INJECT_SPLIT_MS = 150;
/** 热切换成功特征(TUI 状态行;strip ANSI 后匹配)。 */
const RESUME_FEATURE = "Resumed session";
/** 特征等待上限:大会话历史渲染 ~1.2s,留裕量;超时 = 熔断。 */
const RESUME_TIMEOUT_MS = 5_000;
/** 就绪待命上限:超时回收进程(内存 ~700-810MB 不白占)。 */
const IDLE_REAP_MS = 10 * 60_000;
/** activate 后首预热延迟:避开应用启动高峰。 */
const START_DELAY_MS = 8_000;
/** 消费成功后的补货延迟。 */
const REFILL_DELAY_MS = 3_000;
/** 回放尾上限(欢迎屏 ~10KB + 大会话切换 ~170KB,留极端裕量)。 */
const MAX_REPLAY_TAIL_CHARS = 2_000_000;

interface PrewarmSlot {
  sessionId: string;
  cwd: string;
  /** 原始终端字节流(接管回放尾;特征检测取注入后增量 strip 匹配)。 */
  buffer: string;
  ready: boolean;
  dead: boolean;
  /** check-out 原子标记:一次打开动作只消费一次。 */
  acquired: boolean;
  /** 出生桶文件名快照(diff 出空会话文件供清理)。 */
  bornFiles: Set<string>;
  /** 待定特征检测(acquire 注入后挂起;输出/退出回调命中即 resolve,超时兜底在 acquire 侧)。 */
  pendingFeature?: { injectMark: number; resolve: () => void };
  offOutput: () => void;
  offExit: () => void;
  reapTimer?: ReturnType<typeof setTimeout>;
  readyTimer?: ReturnType<typeof setTimeout>;
  /** 出生文件锁定窗(2s/5s 两轮,单新增且空才删;见 prewarmFs.lockAndRemoveBirthFile)。 */
  lockTimer?: ReturnType<typeof setTimeout>;
  lockTried: number;
}

let slot: PrewarmSlot | null = null;
let started = false;
/** 生命周期代数:stop 后在途 spawn 链(已越过的 await)不得落位新 slot。 */
let managerEpoch = 0;
/** 特征熔断:本运行周期不再预热(omp 升级改变切换语义的护栏)。 */
let featureFused = false;
let startTimer: ReturnType<typeof setTimeout> | null = null;
let refillTimer: ReturnType<typeof setTimeout> | null = null;

/** 出生文件锁定窗(ms):spawn 后 omp 落盘空会话通常即时,两轮覆盖慢机。 */
const BIRTH_LOCK_DELAYS_MS = [2_000, 5_000] as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 剥 ANSI 后的纯文本(特征检测用;与 sessionStartFail.crashTail 同族正则的轻量版)。 */
function stripAnsi(raw: string): string {
  return raw.replace(
    /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_].*?\x1b\\|\x1b[@-_]/g,
    "",
  );
}



/** 杀掉并清理当前 slot(强杀:TUI 忽略 SIGTERM);幂等。
 *  出生文件不在此清理:锁定窗(2s/5s)早已窄删,reap 期无「哪一个是出生文件」的
 *  安全判据,宁残留一个空会话文件也不宽删。 */
function reapSlot(kill: boolean): void {
  const s = slot;
  slot = null;
  if (!s) return;
  if (s.reapTimer) clearTimeout(s.reapTimer);
  if (s.readyTimer) clearTimeout(s.readyTimer);
  if (s.lockTimer) clearTimeout(s.lockTimer);
  s.offOutput();
  s.offExit();
  unmarkShadowSession(s.sessionId);
  if (kill) void ipc.sessionKill(s.sessionId).catch(() => undefined);
}

/** 出生文件锁定窗调度:两轮窄删(单新增且空才删),槽位被消费/回收后自然失效。 */
function scheduleBirthLock(s: PrewarmSlot): void {
  const delay = BIRTH_LOCK_DELAYS_MS[s.lockTried];
  if (delay === undefined) return;
  s.lockTimer = setTimeout(() => {
    s.lockTimer = undefined;
    if (slot !== s || s.dead) return;
    s.lockTried += 1;
    void lockAndRemoveBirthFile(s.cwd, s.bornFiles);
    scheduleBirthLock(s);
  }, delay);
}

/** 预热一个裸 omp(cwd 桶匹配是热切换前提)。 */
async function spawnPrewarm(cwd: string): Promise<void> {
  if (featureFused || slot) return;
  const epoch = managerEpoch;
  try {
    const bucket = await ompSessionsDir(cwd);
    if (!bucket) return;
    const bornFiles = new Set((await ipc.fsCollectFiles(bucket, ".jsonl")).map((f) => f.name));
    const spawned = await ipc.sessionSpawn("omp", { command: "omp", args: [], cwd }, undefined);
    if (epoch !== managerEpoch || slot) {
      /* stop 已过境或已有占位:spawn 链作废,即刻回滚(影子标记 + 进程) */
      void ipc.sessionKill(spawned.id).catch(() => undefined);
      return;
    }
    /* spawn 一落地即登记影子:缩小「未隔离会话被会话表合流渗入」的可观测窗口 */
    markShadowSession(spawned.id);
    const s: PrewarmSlot = {
      sessionId: spawned.id,
      cwd,
      buffer: "",
      ready: false,
      dead: false,
      acquired: false,
      bornFiles,
      offOutput: () => undefined,
      offExit: () => undefined,
      lockTried: 0,
    };
    const [offOutput, offExit] = await Promise.all([
      onPtyOutput(s.sessionId, (text) => {
        if (s.buffer.length < MAX_REPLAY_TAIL_CHARS) s.buffer += text;
        /* 特征检测事件驱动:注入后新增字节里出现切换成功标志即唤醒等待方 */
        const p = s.pendingFeature;
        if (p && stripAnsi(s.buffer.slice(p.injectMark)).includes(RESUME_FEATURE)) {
          s.pendingFeature = undefined;
          p.resolve();
        }
      }),
      onPtyExit(s.sessionId, () => {
        s.dead = true;
        const p = s.pendingFeature;
        if (p) {
          s.pendingFeature = undefined;
          p.resolve();
        }
        if (slot === s) reapSlot(false); /* 已死无需 kill */
      }),
    ]);
    s.offOutput = offOutput;
    s.offExit = offExit;
    if (s.dead || epoch !== managerEpoch) {
      /* 订阅 await 缝隙里进程已退 / stop 已过境:成对退订 + 解登记 */
      offOutput();
      offExit();
      unmarkShadowSession(s.sessionId);
      return;
    }
    s.reapTimer = setTimeout(() => {
      if (slot === s && !s.acquired) reapSlot(true);
    }, IDLE_REAP_MS);
    s.readyTimer = setTimeout(() => {
      s.readyTimer = undefined;
      if (slot === s && !s.dead) s.ready = true;
    }, READY_DELAY_MS);
    scheduleBirthLock(s);
    slot = s;
  } catch {
    /* spawn 失败(无 bun/omp)静默:无预热 = 现状冷路径 */
  }
}

/**
 * profile.acquireResume 实现:命中就绪预热进程则注入热切换,返回接管信息。
 * 任何失配返回 null(调用方走默认冷路径)。
 */
export async function ompAcquireResume(
  cwd: string,
  cliSessionId: string,
): Promise<{ sessionId: string; replayTail: string } | null> {
  const s = slot;
  if (!s || !s.ready || s.acquired || s.dead || s.cwd !== cwd || featureFused) return null;
  s.acquired = true;
  const injectMark = s.buffer.length;
  /* 事件驱动等待:特征命中/进程退出由输出与退出回调 resolve,超时在此兜底 */
  const featureOrExit = new Promise<void>((resolve) => {
    s.pendingFeature = { injectMark, resolve };
  });
  try {
    await ipc.sessionWrite(s.sessionId, `/resume ${cliSessionId}`);
    await sleep(INJECT_SPLIT_MS);
    await ipc.sessionWrite(s.sessionId, "\r");
  } catch {
    s.pendingFeature = undefined;
    reapSlot(true);
    return null;
  }
  await Promise.race([featureOrExit, sleep(RESUME_TIMEOUT_MS)]);
  s.pendingFeature = undefined;
  if (s.dead) {
    reapSlot(false); /* exit 回调已清场,此处幂等收口 */
    return null;
  }
  if (!stripAnsi(s.buffer.slice(injectMark)).includes(RESUME_FEATURE)) {
    /* 超时 = omp 行为已变(升级等):熔断本运行周期,强杀降级 */
    featureFused = true;
    reapSlot(true);
    return null;
  }
  /* 接管转正:解除影子登记,进程移交 kernel adopt(输出缓冲经 replayTail
     预灌,本侧订阅退订 —— 后续字节由 adoptPtySession 的常驻订阅接管)。
     出生文件不在此处理:锁定窗窄删已尽其责,消费期无安全判据,宁残留不宽删。 */
  const replayTail = s.buffer;
  s.offOutput();
  s.offExit();
  if (s.reapTimer) clearTimeout(s.reapTimer);
  if (s.readyTimer) clearTimeout(s.readyTimer);
  if (s.lockTimer) clearTimeout(s.lockTimer);
  unmarkShadowSession(s.sessionId);
  slot = null;
  refillTimer = setTimeout(() => {
    refillTimer = null;
    void spawnPrewarm(cwd);
  }, REFILL_DELAY_MS);
  return { sessionId: s.sessionId, replayTail };
}

/** 插件 activate 接线:清杀重载遗留 + 延迟首预热(有近期活动才预热)。 */
export function startOmpPrewarmManager(): void {
  if (started) return;
  started = true;
  /* 重载遗留预热进程:restoreShadowSessions 幂等(readopt 亦调,先到先得);
     进程必杀,出生空文件已无快照可锁定(接受残留一个空会话文件) */
  for (const id of restoreShadowSessions()) {
    void ipc.sessionKill(id).catch(() => undefined);
    unmarkShadowSession(id);
  }
  startTimer = setTimeout(() => {
    startTimer = null;
    void pickPrewarmCwd().then((cwd) => {
      if (cwd) void spawnPrewarm(cwd);
    });
  }, START_DELAY_MS);
}

/** 插件 deactivate 清理(熔断标志保留:同一运行周期的护栏不被重置)。 */
export function stopOmpPrewarmManager(): void {
  managerEpoch += 1; /* 在途 spawn 链(已越过的 await)不得再落位新 slot */
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
  if (refillTimer) clearTimeout(refillTimer);
  refillTimer = null;
  reapSlot(true);
  started = false;
}

/** 测试专用:重置全部模块态。 */
export function resetOmpPrewarmForTest(): void {
  managerEpoch += 1;
  if (startTimer) clearTimeout(startTimer);
  if (refillTimer) clearTimeout(refillTimer);
  startTimer = null;
  refillTimer = null;
  slot = null;
  started = false;
  featureFused = false;
}
