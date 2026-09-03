/**
 * 欢迎页 —— 无活跃 session 时的中央幕布首页(嵌入页,非弹窗)。
 *
 * 区块:
 * 1. 引擎卡 ×N(ENGINE_METAS):探针 + 安装(进度条 + 流式日志)+ 已登录供应商/额度;
 * 2. 近期会话:工作区分组,点击直接续上。
 *
 * 状态集中在页级:探针结果/安装状态按引擎 id 存 Record,卡片纯渲染。
 */

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { host, useHost } from "@kernel/host";
import { ENGINE_METAS, ENGINE_META_BY_ID } from "./engineMeta";
import {
  EngineCard,
  probeEngine,
  useEngineInstall,
  type EngineProbeState,
  type InstallState,
} from "./EngineCard";
import { CredentialList } from "./CredentialList";
import { fetchLatestVersion } from "./latestVersion";
import { RecentSessions } from "./RecentSessions";

function buildInitialProbes(): Record<string, EngineProbeState> {
  return Object.fromEntries(
    ENGINE_METAS.map((m) => [m.id, { status: "loading" as const, result: null }]),
  );
}

/** 单引擎状态容器(探针 + 安装 hook 必须组件化,故每引擎一个子组件)。 */
function EngineSection({
  engineId,
  probe,
  latest,
  onProbe,
}: {
  engineId: string;
  probe: EngineProbeState;
  latest: string | null | undefined;
  onProbe: () => void;
}) {
  const meta = ENGINE_META_BY_ID[engineId];
  const profile = host.getCliProfile(engineId);
  const [install, startInstall] = useEngineInstall(meta, onProbe);
  return (
    <div>
      <EngineCard
        meta={meta}
        profile={profile}
        probe={probe}
        latest={latest}
        install={install}
        onProbe={onProbe}
        onInstall={startInstall}
      />
      {probe.status === "ok" && <CredentialList engineId={engineId} />}
    </div>
  );
}

export function WelcomePage() {
  useHost(); /* 订阅宿主:profile 注册/注销(启动激活、插件市场开关)时重渲染 */
  const [probes, setProbes] = useState<Record<string, EngineProbeState>>(
    buildInitialProbes,
  );
  /* 最新版本:每引擎只拉一次(ref 去重),与探针解耦 —
     重探/安装后最新版不变,无需重拉。undefined=拉取中,null=失败(静默)。 */
  const [latest, setLatest] = useState<Record<string, string | null>>({});
  const latestFetchedRef = useRef<Set<string>>(new Set());
  /* 只展示 profile 已注册的引擎:cli 插件被拔出(禁用)时不激活、不注册,卡片随之消失。
     useMemo 锚定注册集指纹而非 version:host 任意 notify(后台会话的 PTY 输出、
     身份绑定等)都会 bump version,锚 version 会让对话期间每 500ms 重探全部引擎
     (探针页反复闪烁);指纹只在注册集真正变化时改变。 */
  const registrationKey = ENGINE_METAS.map((m) =>
    host.getCliProfile(m.id) ? m.id : "-",
  ).join("|");
  const visibleMetas = useMemo(
    () => ENGINE_METAS.filter((m) => host.getCliProfile(m.id) !== undefined),
    [registrationKey],
  );

  const runProbe = useCallback(async (engineId: string) => {
    const meta = ENGINE_META_BY_ID[engineId];
    if (!meta) return;
    setProbes((prev) => ({
      ...prev,
      [engineId]: { status: "loading", result: null },
    }));
    const next = await probeEngine(meta.binary);
    setProbes((prev) => ({ ...prev, [engineId]: next }));
  }, []);

  /* 首 mount(及可见引擎集变化时)全量探针一次。 */
  useEffect(() => {
    for (const meta of visibleMetas) void runProbe(meta.id);
  }, [runProbe, visibleMetas]);

  /* 可见引擎集确定后,每引擎拉一次最新版本。 */
  useEffect(() => {
    for (const meta of visibleMetas) {
      if (latestFetchedRef.current.has(meta.id)) continue;
      latestFetchedRef.current.add(meta.id);
      void fetchLatestVersion(meta.npmPackage).then((version) =>
        setLatest((prev) => ({ ...prev, [meta.id]: version })),
      );
    }
  }, [visibleMetas]);

  const installedCount = visibleMetas.filter(
    (m) => probes[m.id]?.status === "ok",
  ).length;

  return (
    <div className="welcome-page">
      <div className="welcome-scroll">
        <header className="welcome-hero">
          <h1 className="welcome-title">tmd-cli</h1>
          <p className="welcome-subtitle">
            多 CLI 桌面客户端 —— 已就绪 {installedCount} / {visibleMetas.length} 个引擎
          </p>
        </header>

        <div className="welcome-engines">
          {visibleMetas.map((meta) => (
            <EngineSection
              key={meta.id}
              engineId={meta.id}
              probe={
                probes[meta.id] ?? { status: "loading", result: null }
              }
              latest={latest[meta.id]}
              onProbe={() => void runProbe(meta.id)}
            />
          ))}
        </div>

        <RecentSessions />
      </div>
    </div>
  );
}

/** 安装状态类型 re-export(EngineSection 外部不直接用,保持类型对齐)。 */
export type { InstallState };
