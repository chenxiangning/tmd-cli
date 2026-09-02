/**
 * Ask 提示音 —— 播放管线 + `askDetected` 事件的消费端。
 *
 * 演化(见 openspec/changes/add-ask-badge/design.md):检测(标记正则/ANSI 剥离/
 * 页脚窗口/跨分片尾巴)曾在本模块以第二 PTY 观察者形态自持(add-ask-sound 世代,
 * host 零感知);为给会话列表供「等待确认」标签状态,检测上收至 kernel/askWatch.ts
 * 进 host 主链路 —— 本模块回到纯音频职责,与 turnSound(消费 turnSettled)对称:
 * bootAskSound(main.tsx 调一次)订阅 askDetected,开关开着就播放。
 * 触发语义随检测上收从「每轮一次(时间窗)」变为「每次等待一段一次(状态边沿)」:
 * 一个未回答的提问期间无论重绘多少次只响一次;作答后的下一个提问再响。
 *
 * 播放:wav ?url 懒加载(不进主 chunk)+ promise 缓存(失败逐出)+ Audio.play() 吞错
 * —— 提示音是锦上添花,任何失败都不得影响会话主流程。
 */

import { KernelTopics, type EventBus } from "./events";
import { getSettingsState, ASK_SOUND_IDS, type AskSoundId } from "./settings";

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
 * 播放指定音效(askDetected 消费路径与设置页「测试」按钮共用)。
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

/** 退订句柄:重复 boot 直接复用,不重复订阅重复响。 */
let askUnlisten: (() => void) | null = null;

/** 启动接线:订阅 askDetected(host 主链路检测,见 askWatch.ts),开关开着即播放。 */
export function bootAskSound(bus: EventBus): void {
  if (askUnlisten) return;
  askUnlisten = bus.on<string>(KernelTopics.askDetected, () => {
    const { askSoundEnabled, askSoundId } = getSettingsState().settings;
    if (askSoundEnabled) playAskSound(askSoundId);
  });
}
