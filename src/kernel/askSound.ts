/**
 * Ask 提示音 —— 检测 PTY 输出中「CLI 阻塞等待用户确认」的界面标记并播放提示音。
 *
 * 设计(见 openspec/changes/add-ask-sound/design.md):
 * - 自驱接线:bootAskSound(main.tsx 调一次)订阅 host.events 的会话生命周期,
 *   对每个会话经 ipc.onPtyOutput 挂第二输出观察者 —— host 零感知,热点文件不增行;
 * - 每会话保留 240 字符原始尾巴,新 chunk 拼接后先剥 ANSI 再匹配标记,跨分片/转义劈开都安全;
 * - 轮次边界惰性判定:与 host 活动守望同阈值(输出静默 >2s = 新一轮),去重标记在新轮首块输出时复位;
 * - 播放:wav ?url 懒加载(不进主 chunk)+ promise 缓存(失败逐出)+ Audio.play() 吞错
 *   —— 提示音是锦上添花,任何失败都不得影响会话主流程。
 */

import { onPtyOutput, type SessionMeta } from "./ipc";
import { KernelTopics, type EventBus } from "./events";
import { getSettingsState, ASK_SOUND_IDS, type AskSoundId } from "./settings";

/** Ask/确认界面标记:保守选词(面板标题/页脚提示字面量),助手正文误报概率极低。 */
const ASK_MARKER_RE =
  /Ask \d+ questions?|Enter select\b|Esc(?: to)? cancel\b|[([]y\/n[)\]]/;

/** ANSI 转义序列(CSI/OSC/单字符)——ansi-regex 同款成熟模式,只剥转义不伤可读文本。 */
const ANSI_RE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

/** 输出静默轮次阈值:与 kernel/host 活动守望保持同一语义(2s)。 */
const TURN_SILENCE_MS = 2_000;

/** 剥离 ANSI 转义,只留可读文本用于标记匹配。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** 每会话去重状态:原始尾巴(跨分片拼接)+ 本轮是否已响 + 最近输出时间(轮次边界)。 */
interface AskSessionState {
  rawTail: string;
  notifiedInTurn: boolean;
  lastChunkAt: number;
}

/** 尾巴长度:覆盖标记短字面量的跨分片窗口,又不至于每 chunk 全量重扫。 */
const RAW_TAIL_CHARS = 240;

const sessionStates = new Map<string, AskSessionState>();

/**
 * 会话输出进站(ipc.onPtyOutput 观察者):拼接尾巴 → 剥 ANSI → 命中标记且本轮未响过则播放。
 * 静默超阈值先复位「本轮已响」——去重标记只在输出到达时被读写,惰性结算与守望定时器行为等价。
 */
export function observeSessionOutput(sessionId: string, text: string): void {
  const now = Date.now();
  const state =
    sessionStates.get(sessionId) ?? {
      rawTail: "",
      notifiedInTurn: false,
      lastChunkAt: now,
    };
  if (now - state.lastChunkAt > TURN_SILENCE_MS) state.notifiedInTurn = false;
  state.lastChunkAt = now;
  const combined = state.rawTail + text;
  if (!state.notifiedInTurn && ASK_MARKER_RE.test(stripAnsi(combined))) {
    state.notifiedInTurn = true;
    const { askSoundEnabled, askSoundId } = getSettingsState().settings;
    if (askSoundEnabled) playAskSound(askSoundId);
  }
  state.rawTail =
    combined.length > RAW_TAIL_CHARS
      ? combined.slice(-RAW_TAIL_CHARS)
      : combined;
  sessionStates.set(sessionId, state);
}

/** 会话消亡:清理全部状态,去重不跨会话泄漏。 */
function forgetSession(sessionId: string): void {
  sessionStates.delete(sessionId);
}

/** 内置音效懒加载:首次播放才拉取 wav,promise 缓存,失败逐出使下次重试。 */
const SOUND_URL_LOADERS: Record<AskSoundId, () => Promise<string>> = {
  default: () =>
    import("../assets/sounds/success.wav?url").then((m) => m.default),
  chime: () => import("../assets/sounds/chime.wav?url").then((m) => m.default),
  bell: () => import("../assets/sounds/bell.wav?url").then((m) => m.default),
  ding: () => import("../assets/sounds/ding.wav?url").then((m) => m.default),
};

const soundUrlPromises = new Map<AskSoundId, Promise<string>>();

function loadSoundUrl(soundId: AskSoundId): Promise<string> {
  let promise = soundUrlPromises.get(soundId);
  if (!promise) {
    promise = SOUND_URL_LOADERS[soundId]();
    promise.catch(() => soundUrlPromises.delete(soundId));
    soundUrlPromises.set(soundId, promise);
  }
  return promise;
}

/** 白名单外 id(手改 JSON/旧版本)回落 default。 */
export function resolveAskSoundId(soundId: unknown): AskSoundId {
  return ASK_SOUND_IDS.includes(soundId as AskSoundId)
    ? (soundId as AskSoundId)
    : "default";
}

/**
 * 播放指定音效(检测路径与设置页「测试」按钮共用)。
 * Audio.play 失败静默:浏览器 dev 自动播放策略、异常 WebView 等场景不打扰主流程。
 */
export function playAskSound(soundId: unknown): void {
  loadSoundUrl(resolveAskSoundId(soundId))
    .then((url) => {
      try {
        const audio = new Audio(url);
        audio.volume = 1;
        void audio.play().catch(() => undefined);
      } catch {
        // 无 Audio 环境(异常 WebView):提示音不可用,静默跳过。
      }
    })
    .catch(() => undefined);
}

// ---- 自驱接线(bootAskSound,main.tsx 调一次) ------------------------------

/** 已订阅输出的会话退订函数(Tauri listen 返回 Promise<UnlistenFn>)。 */
const outputUnlisteners = new Map<string, Promise<() => void>>();

function watchSession(sessionId: string): void {
  if (outputUnlisteners.has(sessionId)) return;
  const unlisten = onPtyOutput(sessionId, (text) =>
    observeSessionOutput(sessionId, text),
  ).catch(() => () => undefined); // 浏览器 dev 无 Tauri 事件:退订为空操作
  outputUnlisteners.set(sessionId, unlisten);
}

async function unwatchSession(sessionId: string): Promise<void> {
  const unlisten = outputUnlisteners.get(sessionId);
  if (!unlisten) return;
  outputUnlisteners.delete(sessionId);
  forgetSession(sessionId);
  (await unlisten)();
}

function syncSessions(sessions: readonly SessionMeta[]): void {
  const alive = new Set(sessions.map((s) => s.id));
  for (const id of alive) watchSession(id);
  for (const id of [...outputUnlisteners.keys()]) {
    if (!alive.has(id)) void unwatchSession(id);
  }
}

/** 启动接线:会话表差分挂观察者,进程退出立即清理。main.tsx 在插件激活前调用。 */
export function bootAskSound(bus: EventBus): void {
  bus.on<SessionMeta[]>(KernelTopics.sessionsChanged, syncSessions);
  bus.on<string>(KernelTopics.sessionExited, (id) => void unwatchSession(id));
}
