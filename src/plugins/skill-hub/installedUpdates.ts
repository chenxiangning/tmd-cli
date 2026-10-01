/**
 * 已装更新探测 ── 商店来源且有版本的记录,按记录名(slug)逐条拉 ClawHub
 * 详情比 latestVersion(isNewerSkillVersion 语义化近似)。
 *
 * 如实原则:无版本记录、详情失败(重名 slug 409 / 网络)、无新版 ── 一律
 * 不进结果(不显「可更新」)。结果 Map<记录名, 详情卡> 供「更新」钮重跑
 * 下载安装链(InstallDialog 直吃 ClawHubDetail)。
 */

import { useEffect, useState } from "react";
import type { InstalledSkillRecord } from "@plugins/cli-shared/skillRegistry";
import { getClawHubSkillDetail } from "./clawhub";
import { isNewerSkillVersion, type ClawHubCard } from "./clawhubNormalize";

/** 已装记录 → 有新版的子集(记录名 → ClawHub 详情卡)。 */
export function useSkillUpdates(
  records: readonly InstalledSkillRecord[],
): ReadonlyMap<string, ClawHubCard> {
  const [updates, setUpdates] = useState<ReadonlyMap<string, ClawHubCard>>(new Map());

  // eslint-disable-next-line react-doctor/no-set-state-after-await-in-effect -- alive 守卫防卸载后写入;探测结果非派生值,必须落 state
  useEffect(() => {
    let alive = true;
    const storeRecords = records.filter((r) => r.source === "store" && r.version);
    void (async () => {
      const next = new Map<string, ClawHubCard>();
      /* eslint-disable react-doctor/async-await-in-loop -- 逐记录串行探测(个位数),
         单条失败 catch 吞 = 如实不显更新,不影响其余。 */
      for (const rec of storeRecords) {
        try {
          const detail = await getClawHubSkillDetail(rec.name);
          if (isNewerSkillVersion(detail.latestVersion, rec.version ?? "")) {
            next.set(rec.name, detail);
          }
        } catch {
          /* 无版本信息/不可达 = 不出更新态 */
        }
      }
      /* eslint-enable react-doctor/async-await-in-loop */
      if (alive) setUpdates(next);
    })();
    return () => {
      alive = false;
    };
  }, [records]);

  return updates;
}
