/**
 * Java 引导卡状态源(组件文件不能出非组件导出 —— react-doctor only-export-components)。
 * 「暂不安装」= 永不再弹:dismissed 标记持久化 localStorage(对齐 academyProgress
 * 模式:惰性首读 + try/catch 容错,隐私模式/配额满降级会话内一次语义)。
 */
import { createSubscribable } from "@kernel/subscribable";

const DISMISS_KEY = "tmd.lsp.javaGuide.dismissed.v1";

const guideStore = createSubscribable({ visible: false });

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** java 配置 discover 无命中时调用(每次手势都会试);已 dismiss 则永不再弹。 */
export function openJavaGuide() {
  if (dismissed()) return;
  if (!guideStore.snapshot.visible) guideStore.commit({ visible: true });
}

/** 「暂不安装」:落持久标记,跨启动永不再弹。 */
export function dismissJavaGuide() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* 写不进(隐私模式/配额满):本会话内不再弹,降级可接受 */
  }
  guideStore.commit({ visible: false });
}

/** 会话内收卡(Escape/背景点击/装完):不落标记,下次启动可再弹。 */
export function closeJavaGuide() {
  guideStore.commit({ visible: false });
}

export function useJavaGuideVisible() {
  return guideStore.useStore().visible;
}
