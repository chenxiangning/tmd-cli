/**
 * 单引擎状态容器(自 WelcomePage 拆出,300 行铁则):探针 + 安装 hook
 * 必须组件化,故每引擎一个子组件;新会话动作由页级注入的 onNewSession
 * 承载(prompt 行选中的工作区在页级持有)。
 */

import { host } from "@kernel/host";
import { useHomePanels } from "@kernel/homePanels";
import type { EngineMeta } from "./engineMeta";
import type { EngineCredential } from "./credentials";
import { EngineCard, useEngineInstall, type EngineProbeState } from "./EngineCard";

export function EngineSection({
  meta,
  probe,
  depProbe,
  latest,
  creds,
  expanded,
  onToggleExpand,
  cursor,
  onCursor,
  onProbe,
  onDepProbe,
  onNewSession,
}: {
  meta: EngineMeta;
  probe: EngineProbeState;
  /** 前置依赖探针状态(meta.requires 存在时由页级传入)。 */
  depProbe?: EngineProbeState;
  latest: string | null | undefined;
  creds: EngineCredential[] | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  cursor: boolean;
  /** 点击行主体 = 游标移到本行。 */
  onCursor: () => void;
  onProbe: () => void;
  /** 重探前置依赖(参数 = 依赖 binary)。 */
  onDepProbe: (binary: string) => void;
  /** 以页级选中工作区启动本引擎新会话。 */
  onNewSession: () => void;
}) {
  const engineId = meta.id;
  const profile = host.getCliProfile(engineId);
  const [install, startInstall] = useEngineInstall(meta, onProbe);
  const HomePanel = useHomePanels().get(engineId);
  /* 依赖安装完成 → 重探依赖;探针 ok 后 EngineCard 的主引擎按钮自动解锁。 */
  const requires = meta.requires ?? null;
  const [depInstall, startDepInstall] = useEngineInstall(requires, () => {
    if (requires) onDepProbe(requires.binary);
  });
  return (
    <EngineCard
      meta={meta}
      profile={profile}
      probe={probe}
      latest={latest}
      install={install}
      onProbe={onProbe}
      onInstall={startInstall}
      depProbe={depProbe}
      depInstall={depInstall}
      onDepInstall={startDepInstall}
      onDepProbe={() => requires && onDepProbe(requires.binary)}
      creds={creds}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      cursor={cursor}
      onCursor={onCursor}
      onNewSession={onNewSession}
      homePanel={HomePanel ? <HomePanel /> : undefined}
    />
  );
}
