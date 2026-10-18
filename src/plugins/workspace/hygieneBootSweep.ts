/**
 * 启动补扫 —— 应用启动后 45s 一次性 setTimeout,对每个本地工作区跑扫描+卫生清扫。
 *
 * 为什么存在:清扫只挂 useCliDiskScan 的扫描结算点(展开/刷新等事件驱动),
 * 长期不展开的工作区永不清扫,超期会话滞留默认视图。此处一次性兜底,零轮询:
 * 跑完即止,不挂任何周期定时器。
 *
 * 边界(与 hook 侧 scanAndSweep 共用核心,deleted>0 只记数不触发 UI 补扫:
 * 后台路径没有挂载的卡片行,下次前台扫描自然反映):
 * - 仅本地工作区:findWorkspaceOrigin 命中 = 远程/SSH/WSL 来源,跳过保护性能;
 * - 前台正在扫描的 (工作区, CLI) 跳过(读 useCliDiskScan 在途登记避免双扫;
 *   清扫幂等,漏扫无碍);
 * - 顺序逐区逐 profile,不并行(启动期 IO 让路);无 listSessions 的 profile 跳过;
 * - 单区失败不阻断后续工作区。
 */

import { host } from "@kernel/host";
import { getWorkspaces, workspacesReady } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { scanAndSweep } from "./sessionSweep";
import { foregroundScansInflight } from "./useCliDiskScan";

/** 启动补扫延迟:给前台首屏扫描与用户首操作让路,45s 内用户展开的区由前台管。 */
const BOOT_SWEEP_DELAY_MS = 45_000;

/** 顺序补扫全部本地工作区;返回删除的会话总数(仅记数)。 */
export async function bootSweepLocalWorkspaces(): Promise<number> {
  /* 工作区表自磁盘装载是异步的,等待就绪(慢盘 >45s 时宁可不扫也不扫空表)。 */
  await workspacesReady.catch(() => undefined);
  let deletedTotal = 0;
  for (const ws of getWorkspaces()) {
    if (findWorkspaceOrigin(ws)) continue; /* 远程/SSH/WSL 来源:跳过 */
    for (const profile of host.getCliProfiles()) {
      if (!profile.listSessions) continue;
      const key = `${ws.id}:${profile.id}`;
      if (foregroundScansInflight.has(key)) continue; /* 前台在扫:让路 */
      try {
        deletedTotal += await scanAndSweep({
          profile,
          workspace: ws,
          scan: () => profile.listSessions!(ws.root),
          getLiveCliIds: () =>
            new Set(
              host
                .getSessions()
                .filter(
                  (s) =>
                    s.workspaceId === ws.id &&
                    (s.profileId === profile.id || s.engine === profile.id),
                )
                .map((s) => host.getCliSessionId(s.id))
                .filter((id): id is string => id !== undefined),
            ),
          allowDelete: true,
        });
      } catch {
        /* 单区失败不阻断后续工作区 */
      }
    }
  }
  return deletedTotal;
}

/** activate 期挂载:启动后 45s 一次性补扫;返回取消函数(插件拔出时清定时器)。 */
export function scheduleBootSweep(): () => void {
  const timer = setTimeout(() => {
    void bootSweepLocalWorkspaces();
  }, BOOT_SWEEP_DELAY_MS);
  return () => clearTimeout(timer);
}
