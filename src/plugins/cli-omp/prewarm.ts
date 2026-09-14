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
 * 降级闭环:池空 / cwd 不匹配 / 未就绪 → 返回 null,sessionSpawn 走默认冷路径。
 * 注入派发即移交 kernel 早激活(打开零顿挫的关键:激活是打开路径唯一的状态
 * 切换,不再压在整段 resume 渲染之后);此后特征超时熔断(本运行周期不再预热,
 * omp 升级改语义的护栏)不再回退冷路径也不杀进程 —— 失败的 resume 字面可见,
 * 关 tab 即清;仅注入失败/接管装配落败(adopt 尚未完成的窄窗内进程死亡,early
 * 归 null)回退冷路径;装配完成后死亡走常驻订阅退出链,不回退。
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
import {
  BIRTH_LOCK_DELAYS_MS,
  IDLE_REAP_MS,
  INJECT_SPLIT_MS,
  MAX_REPLAY_TAIL_CHARS,
  READY_DELAY_MS,
  REFILL_DELAY_MS,
  RESUME_FEATURE,
  RESUME_TIMEOUT_MS,
  START_DELAY_MS,
} from "./prewarmTimings";

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

/** 补货调度:仅用户动作驱动(handover 成功/注入失败重试)。空闲回收与进程自行退出
 *  不补货:无闸门补货在 omp 启动即死时是 1s 崩溃循环,空闲补货是 10min 永久空转。 */
function scheduleRefill(cwd: string): void {
  if (featureFused || refillTimer) return;
  refillTimer = setTimeout(() => {
    refillTimer = null;
    void spawnPrewarm(cwd);
  }, REFILL_DELAY_MS);
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
        if (p) { s.pendingFeature = undefined; p.resolve(); }
        if (slot === s) reapSlot(false); /* 已死无需 kill;不补货(防崩溃循环) */
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
      if (slot === s && !s.acquired) reapSlot(true); /* 空闲回收;不补货(资源取舍) */
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
 * 任何失配返回 null。注入派发即经 signals.onAcquired 移交 kernel 早激活
 * (幕布立即挂载,渲染经常驻订阅直入,不再等整段渲染完成才切换);本钩子
 * 此后只余特征护栏职责。
 */
export async function ompAcquireResume(
  cwd: string,
  cliSessionId: string,
  signals?: { onAcquired(sessionId: string): void },
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
    scheduleRefill(s.cwd);
    return null; /* 注入失败未移交:kernel 无 early,照旧回退冷路径 */
  }
  /* 注入已派发即移交:先解影子(否则 kernel setSessions 把它滤出会话表,
     激活了也无处显示)再回调早激活。replayTail 空手而回:渲染字节由常驻
     订阅入缓冲,预灌只会重复。出生文件锁定窗此前已尽其责,不在此处理。 */
  unmarkShadowSession(s.sessionId);
  signals?.onAcquired(s.sessionId);
  await Promise.race([featureOrExit, sleep(RESUME_TIMEOUT_MS)]);
  s.pendingFeature = undefined;
  /* 转正收尾:退订 + 清计时器 + 补货(熔断时 spawnPrewarm 自查 featureFused
     空转)。影子登记已在移交时解除,进程归 kernel —— 收尾绝不再杀。 */
  const handover = (): void => {
    s.offOutput();
    s.offExit();
    clearTimeout(s.reapTimer);
    clearTimeout(s.readyTimer);
    clearTimeout(s.lockTimer);
    slot = null;
    scheduleRefill(cwd);
  };
  if (s.dead) {
    return null; /* 进程死亡:exit 回调已清场(收尾幂等);kernel 侧 adopt
                    竞态守卫同样落败,早激活自愈回退冷路径 */
  }
  if (!stripAnsi(s.buffer.slice(injectMark)).includes(RESUME_FEATURE)) {
    /* 超时 = omp 行为已变(升级等):熔断本运行周期。进程已移交成用户会话,
       不再强杀 —— 失败的 resume 字面可见(/resume 文本停在 composer),关
       tab 即清。护栏从「静默回退冷路径」退化为「可见失败 + 熔断」,换每次
       打开零顿挫。 */
    featureFused = true;
    handover();
    return null;
  }
  handover();
  return { sessionId: s.sessionId, replayTail: "" };
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
