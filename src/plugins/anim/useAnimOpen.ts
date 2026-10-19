/**
 * anim 「打开」动作面(042 随手带,0.3.9 口径修订)—— 自 animProjectsTab 拆出
 * (文件规模铁则)。平台分派见 animProjects.animOpenAction:
 *  mac = tmd-anim 应用 open-with(`open -a`,挂载即探测,缺席常驻引导横幅,
 *  非 mac 误报「未安装」横幅的教训保留);windows = 文件管理器目录定位
 *  (explorer /select 原语,fsRevealInFileManager,无桌面应用探测语义);
 *  其余平台 = 无打开动作。失败一律 toast,不抛错。
 */
import { useEffect, useState } from "react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { getPlatformKind } from "@kernel/platform";
import type { OpenWithTarget } from "@kernel/settingsTypes";
import { animOpenAction } from "./animProjects";

/** fsOpenWith 的 tmd-anim 应用目标(mac `open -a tmd-anim`;productName 即应用名)。 */
const ANIM_APP_TARGET: OpenWithTarget = { id: "tmd-anim", label: "tmd-anim", kind: "app", appName: "tmd-anim" };

export function useAnimOpen(showToast: (m: string) => void) {
  /* null = 探测未归;false → 常驻未安装引导横幅(点「打开」时仍会复核探测)。 */
  const [appInstalled, setAppInstalled] = useState<boolean | null>(null);
  const action = animOpenAction(getPlatformKind());

  /* 挂载即探测 tmd-anim 应用(仅 mac 打开语义需要;探测失败不抛错,保持 null 不打扰)。 */
  useEffect(() => {
    if (action !== "app") return;
    let alive = true;
    ipc
      .fsProbeOpenApp(ANIM_APP_TARGET)
      .then((probe) => {
        if (alive) setAppInstalled(probe.ok);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [action]);

  const open = async (path: string) => {
    if (action === "reveal") {
      try {
        await ipc.fsRevealInFileManager(path);
      } catch {
        showToast(t("打开失败"));
      }
      return;
    }
    try {
      const probe = await ipc.fsProbeOpenApp(ANIM_APP_TARGET);
      if (!probe.ok) {
        showToast(t("未检测到 tmd-anim,请先安装"));
        return;
      }
      await ipc.fsOpenWith(path, ANIM_APP_TARGET);
    } catch {
      showToast(t("打开失败"));
    }
  };

  return { action, appInstalled, open };
}
