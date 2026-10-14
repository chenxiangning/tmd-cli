/**
 * 应用 Logo 注册表 —— 品牌位图标 id → 资产/展示名(iconSet 同款分法:
 * 白名单与清洗在 settingsAppearance.ts,这里只持展示知识)。
 * 消费方:app-shell/LeftRail(侧栏设置钮)、wsl 插件品牌行、settings 外观页切换网格。
 * label 走动态键 t(field),词条在 kernel/locales/{en,ja}/settings.ts。
 */

import classicUrl from "../assets/logo.png";
import multiOrbitHubUrl from "../assets/logos/multi-orbit-hub.png";
import openStarRingUrl from "../assets/logos/open-star-ring.png";
import gravitationalCoreUrl from "../assets/logos/gravitational-core.png";
import dualOrbitHandoffUrl from "../assets/logos/dual-orbit-handoff.png";
import layeredControlPlaneUrl from "../assets/logos/layered-control-plane.png";
import fourPortRouterUrl from "../assets/logos/four-port-router.png";
import triadicRouterUrl from "../assets/logos/triadic-router.png";
import type { AppLogoId } from "./settingsAppearance";

export interface AppLogoDefinition {
  id: AppLogoId;
  label: string;
  url: string;
}

/** 顺序即外观页网格展示序:classic 恒首(出厂现状)。 */
export const APP_LOGOS: readonly AppLogoDefinition[] = [
  { id: "classic", label: "经典", url: classicUrl },
  { id: "multi-orbit-hub", label: "多轨枢纽", url: multiOrbitHubUrl },
  { id: "open-star-ring", label: "开放星环", url: openStarRingUrl },
  { id: "gravitational-core", label: "引力核心", url: gravitationalCoreUrl },
  { id: "dual-orbit-handoff", label: "双轨接力", url: dualOrbitHandoffUrl },
  { id: "layered-control-plane", label: "层叠控制面", url: layeredControlPlaneUrl },
  { id: "four-port-router", label: "四口路由", url: fourPortRouterUrl },
  { id: "triadic-router", label: "三叉路由", url: triadicRouterUrl },
];

const APP_LOGO_URLS: Record<AppLogoId, string> = Object.fromEntries(
  APP_LOGOS.map(({ id, url }) => [id, url]),
) as Record<AppLogoId, string>;

/** 按 id 取资产 url;白名单类型已兜底,无运行时回落面。 */
export function getAppLogoUrl(id: AppLogoId): string {
  return APP_LOGO_URLS[id];
}
