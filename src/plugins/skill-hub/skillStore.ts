/**
 * 扫描缓存 store(本地导入视图数据源)+ 安装记录桥接(v2 闭环)。
 *
 * 「已安装」语义在 skillRegistry(记录=0 起步);本 store 只服务导入视图的
 * 十家目录发现缓存;安装/导入/删除后 refreshSkillScan 同步强制重扫 + 记录 reload。
 */

import { ipc } from "@kernel/ipc";
import { createSubscribable } from "@kernel/subscribable";
import { loadSkillRegistry } from "@plugins/cli-shared/skillRegistry";
import { scanAllSkillSources, type HubSkill, type SkillEngineGroup } from "./skillScan";

export interface SkillScanState {
  groups: readonly SkillEngineGroup[];
  loading: boolean;
  /** 最近一次扫描失败原因(目录全失败等);缺 null。 */
  error: string | null;
}

const store = createSubscribable<SkillScanState>({
  groups: [],
  loading: false,
  error: null,
});

let loaded = false;
let inFlight: Promise<void> | null = null;

async function run(force: boolean): Promise<void> {
  if (inFlight) return inFlight;
  if (loaded && !force) return;
  store.commit({ ...store.snapshot, loading: true, error: null });
  inFlight = (async () => {
    try {
      const home = await ipc.configHomeDir();
      store.commit({ groups: await scanAllSkillSources(home), loading: false, error: null });
      loaded = true;
    } catch (e) {
      store.commit({ groups: [], loading: false, error: String(e) });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** 首开加载(幂等;已扫过不重扫)。 */
export function ensureSkillScanLoaded(): Promise<void> {
  void loadSkillRegistry();
  return run(false);
}

/** 强制重扫 + 记录重载(删除/安装/导入后失效缓存)。 */
export function refreshSkillScan(): Promise<void> {
  void loadSkillRegistry(true);
  loaded = false;
  return run(true);
}

/** React 订阅(导入视图/商店已装徽标用)。 */
export function useSkillScan(): SkillScanState {
  return store.useStore();
}

/** 全量已装 skill 扁平视图(商店「已装」徽标匹配用)。 */
export function allInstalledSkills(): readonly HubSkill[] {
  return store.snapshot.groups.flatMap((g) => g.skills);
}
