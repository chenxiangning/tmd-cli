/**
 * 图标装饰引擎 —— settings.iconDecor → <html> CSS 变量 + 呼吸闪烁属性。
 *
 * 变量名约定:`--icon-decor-<id>`;闪烁:`<html data-icon-blink="id1 id2">`,
 * 消费选择器表在 styles/icon-decor.css。kernel 不认识任何图标语义,
 * id 语义归消费端 CSS 与设置卡清单(settings 插件)。main.tsx 调 bootIconDecor(),幂等。
 */

import {
  ICON_DECOR_IDS,
  getSettingsState,
  subscribeSettings,
} from "./settings";

function applyIconDecor(): void {
  const decor = getSettingsState().settings.iconDecor;
  const rootStyle = document.documentElement.style;
  const blinkIds: string[] = [];
  for (const id of ICON_DECOR_IDS) {
    const item = decor[id];
    if (item.color) {
      rootStyle.setProperty(`--icon-decor-${id}`, item.color);
    } else {
      rootStyle.removeProperty(`--icon-decor-${id}`);
    }
    if (item.blink) blinkIds.push(id);
  }
  if (blinkIds.length > 0) {
    document.documentElement.dataset.iconBlink = blinkIds.join(" ");
  } else {
    delete document.documentElement.dataset.iconBlink;
  }
}

let booted = false;

/** 启动时调用一次:应用当前装饰并跟随设置变化。 */
export function bootIconDecor(): void {
  if (booted) return;
  booted = true;
  applyIconDecor();
  subscribeSettings(applyIconDecor);
}
