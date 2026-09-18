/** Java 引导卡状态源(组件文件不能出非组件导出 —— react-doctor only-export-components)。 */
import { createSubscribable } from "@kernel/subscribable";

const guideStore = createSubscribable({ visible: false });

/** java 配置 discover 无命中时调用(每次手势都会试;卡只弹一次)。 */
export function openJavaGuide() {
  if (!guideStore.snapshot.visible) guideStore.commit({ visible: true });
}

export function closeJavaGuide() {
  guideStore.commit({ visible: false });
}

export function useJavaGuideVisible() {
  return guideStore.useStore().visible;
}
