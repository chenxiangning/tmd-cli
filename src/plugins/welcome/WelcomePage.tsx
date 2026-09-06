/**
 * 欢迎页 —— 无活跃 session 时的中央幕布首页(嵌入页,非弹窗)。
 *
 * 区块:
 * 1. 引擎卡 ×N(engineMetas() 派生自已注册 profile):探针 + 安装 + 已登录供应商/额度;
 * 2. 近期会话:工作区分组,点击直接续上。
 *
 * 状态集中在页级:探针结果/安装状态按引擎 id 存 Record,卡片纯渲染。
 */

import { openExternalUrl } from "@kernel/ipc";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { host, useHost } from "@kernel/host";
import { useHomePanels } from "@kernel/homePanels";
import {
  engineMetas,
  type EngineMeta,
  type PrerequisiteMeta,
} from "./engineMeta";

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

const GITHUB_SVG = (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

function buildInitialProbes(): Record<string, EngineProbeState> {
  return Object.fromEntries(
    engineMetas().map((m) => [m.id, { status: "loading" as const, result: null }]),
  );
}

/** 单引擎状态容器(探针 + 安装 hook 必须组件化,故每引擎一个子组件)。 */
function EngineSection({
  meta,
  probe,
  depProbe,
  latest,
  onProbe,
  onDepProbe,
}: {
  meta: EngineMeta;
  probe: EngineProbeState;
  /** 前置依赖探针状态(meta.requires 存在时由页级传入)。 */
  depProbe?: EngineProbeState;
  latest: string | null | undefined;
  onProbe: () => void;
  /** 重探前置依赖(参数 = 依赖 binary)。 */
  onDepProbe: (binary: string) => void;
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
    <div>
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
      />
      {probe.status === "ok" && <CredentialList engineId={engineId} />}
      {HomePanel && <HomePanel />}
    </div>
  );
}

export function WelcomePage() {
  useHost(); /* 订阅宿主:profile 注册/注销(启动激活、插件市场开关)时重渲染 */
  const [probes, setProbes] = useState<Record<string, EngineProbeState>>(
    buildInitialProbes,
  );
  /* 前置依赖探针状态(按 binary 索引;多个引擎可共享同一依赖,如 bun)。 */
  const [depProbes, setDepProbes] = useState<Record<string, EngineProbeState>>(
    {},
  );
  /* 最新版本:每引擎只拉一次(ref 去重),与探针解耦 —
     重探/安装后最新版不变,无需重拉。undefined=拉取中,null=失败(静默)。 */
  const [latest, setLatest] = useState<Record<string, string | null>>({});
  const latestFetchedRef = useRef<Set<string>>(new Set());
  /* 只展示 profile 已注册的引擎:cli 插件被拔出(禁用)时不激活、不注册,卡片随之消失。
     useMemo 锚定注册集指纹而非 version:host 任意 notify(后台会话的 PTY 输出、
     身份绑定等)都会 bump version,锚 version 会让对话期间每 500ms 重探全部引擎
     (探针页反复闪烁);指纹只在注册集真正变化时改变。 */
  const registrationKey = engineMetas().map((m) => m.id).join("|");
  const visibleMetas = useMemo(
    () => engineMetas(),
    [registrationKey],
  );
  /* 去重后的前置依赖集:引擎自身探针之外,requires 声明的依赖也要探 ——
     未就位时引擎的安装/更新按钮被门控(见 EngineCard depBlocked)。 */
  const requires = useMemo(() => {
    const byBinary = new Map<string, PrerequisiteMeta>();
    for (const meta of visibleMetas) {
      if (meta.requires && !byBinary.has(meta.requires.binary)) {
        byBinary.set(meta.requires.binary, meta.requires);
      }
    }
    return [...byBinary.values()];
  }, [visibleMetas]);

  const runProbe = useCallback(async (engineId: string) => {
    const meta = engineMetas().find((m) => m.id === engineId);
    if (!meta) return;
    setProbes((prev) => ({
      ...prev,
      [engineId]: { status: "loading", result: null },
    }));
    const next = await probeEngine(meta.binary);
    setProbes((prev) => ({ ...prev, [engineId]: next }));
  }, []);

  /* 前置依赖探针动作(按 binary)。 */
  const runDepProbe = useCallback(async (binary: string) => {
    setDepProbes((prev) => ({
      ...prev,
      [binary]: { status: "loading", result: null },
    }));
    const next = await probeEngine(binary);
    setDepProbes((prev) => ({ ...prev, [binary]: next }));
  }, []);

  /* 首 mount(及可见引擎集变化时)全量探针一次。 */
  useEffect(() => {
    for (const meta of visibleMetas) void runProbe(meta.id);
    for (const req of requires) void runDepProbe(req.binary);
  }, [runProbe, runDepProbe, visibleMetas, requires]);

  /* 可见引擎集确定后,每引擎拉一次最新版本。 */
  useEffect(() => {
    for (const meta of visibleMetas) {
      if (!meta.npmPackage) continue;
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
          <a
            className="welcome-github-link"
            href="https://github.com/chenxiangning/tmd-cli"
            onClick={(e) => {
              e.preventDefault();
              void openExternalUrl("https://github.com/chenxiangning/tmd-cli");
            }}
          >
            {GITHUB_SVG}
            <span>GitHub 仓库</span>
            <span className="welcome-github-license">MIT</span>
          </a>
        </header>

        <div className="welcome-engines">
          {visibleMetas.map((meta) => (
            <EngineSection
              key={meta.id}
              meta={meta}
              probe={
                probes[meta.id] ?? { status: "loading", result: null }
              }
              depProbe={
                meta.requires ? depProbes[meta.requires.binary] : undefined
              }
              latest={latest[meta.id]}
              onProbe={() => void runProbe(meta.id)}
              onDepProbe={(binary) => void runDepProbe(binary)}
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
