/**
 * 欢迎页 —— 无活跃 session 时的中央幕布首页(终端窗体;原型
 * docs/design/home-redesign-s-full-actions.html)。
 *
 * 结构:窗体标题条 / prompt 行(工作区选择,右侧 engines/updates 统计)/
 * 引擎全动作行 ×N / 页脚(RESUME + QUOTA)。状态集中在页级:探针/最新版/凭据盘点
 * 按引擎 id 存 Record,行纯渲染;凭据详情点击行内 ● 展开,homePanel 常驻行下。
 * 键盘:↑↓ 移游标、⏎ 以所选工作区启动游标引擎新会话(组件局部,不进命令注册表)。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { Mounts } from "@kernel/Mounts";
import { useWorkspaces, workspaceDisplayName } from "@kernel/workspace";
import { shortenHome, useHomeDir } from "./homeDir";
import { engineMetas, type PrerequisiteMeta } from "./engineMeta";
import { type EngineProbeState } from "./EngineCard";
import { probeEngine } from "./engineProbe";
import { listEngineCredentials, type EngineCredential } from "./credentials";
import { fetchLatestVersion, isOutdated } from "./latestVersion";
import {
  buildInitialProbes,
  credsCache,
  depProbeCache,
  latestCache,
  latestFetched,
  probeCache,
} from "./pageCache";
import { EngineSection } from "./EngineSection";
import { WelcomeFooter } from "./WelcomeFooter";
import { WelcomeTbar } from "./WelcomeTbar";
import { TokenDashboard } from "./TokenDashboard";

export function WelcomePage() {
  /* 订阅快照 = 注册集指纹:仅 profile 注册/注销(启动激活、插件市场开关)时
     重渲染。宿主其余通知(输出/状态/标题/切换会话)与本页无关 —— welcome 自
     keep-alive 常驻挂载后,不再为它们付整页渲染(display:none 下 React 照跑)。 */
  const registrationKey = useSyncExternalStore(
    host.subscribe,
    () => engineMetas().map((m) => m.id).join("|"),
  );
  const [probes, setProbes] = useState<Record<string, EngineProbeState>>(
    buildInitialProbes,
  );
  /* 前置依赖探针状态(按 binary 索引;多个引擎可共享同一依赖,如 bun)。 */
  const [depProbes, setDepProbes] = useState<Record<string, EngineProbeState>>(
    () => ({ ...Object.fromEntries(depProbeCache) }),
  );
  /* 最新版本:每引擎每次应用运行只拉一次(模块级去重),与探针解耦 —
     重探/安装后最新版不变,无需重拉。undefined=拉取中,null=失败(静默)。 */
  const [latest, setLatest] = useState<Record<string, string | null>>(
    () => ({ ...Object.fromEntries(latestCache) }),
  );
  /* 凭据盘点(页级一次拉全部引擎):行内凭据列 / 展开详情 / 页脚 QUOTA 共用。 */
  const [credsMap, setCredsMap] = useState<Record<string, EngineCredential[]>>(
    () => ({ ...Object.fromEntries(credsCache) }),
  );
  /* 手动刷新计数:>0 时最新版/凭据 effect 绕过去重重拉(探针由 refreshAll 直推)。 */
  const [refreshTick, setRefreshTick] = useState(0);
  /* 行展开集(点击 ● 切换;凭据详情展开语义)。 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /* 键盘游标(visibleMetas 下标)。 */
  const [cursor, setCursor] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { list: workspaces } = useWorkspaces();
  const home = useHomeDir();
  const [wsId, setWsId] = useState<string | null>(null);
  const ws = useMemo(
    () => workspaces.find((w) => w.id === wsId) ?? workspaces[0] ?? null,
    [workspaces, wsId],
  );

  /* 只展示 profile 已注册的引擎:cli 插件被拔出(禁用)时不激活、不注册,行随之消失。 */
  const visibleMetas = useMemo(() => engineMetas(), [registrationKey]);
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

  const runProbe = useCallback(async (engineId: string, force = false) => {
    const meta = engineMetas().find((m) => m.id === engineId);
    if (!meta) return;
    /* 有缓存且非手动刷新 = 重验:静默跑,值落定才覆盖(不落 loading,回首页无闪烁)。 */
    if (force || !probeCache.has(engineId)) {
      setProbes((prev) => ({
        ...prev,
        [engineId]: { status: "loading", result: null },
      }));
    }
    const next = await probeEngine(meta.binary);
    probeCache.set(engineId, next);
    setProbes((prev) => ({ ...prev, [engineId]: next }));
  }, []);

  /* 前置依赖探针动作(按 binary)。 */
  const runDepProbe = useCallback(async (binary: string, force = false) => {
    if (force || !depProbeCache.has(binary)) {
      setDepProbes((prev) => ({
        ...prev,
        [binary]: { status: "loading", result: null },
      }));
    }
    const next = await probeEngine(binary);
    depProbeCache.set(binary, next);
    setDepProbes((prev) => ({ ...prev, [binary]: next }));
  }, []);

  /* 首 mount(及可见引擎集变化时)全量探针一次。 */
  useEffect(() => {
    for (const meta of visibleMetas) void runProbe(meta.id);
    for (const req of requires) void runDepProbe(req.binary);
  }, [runProbe, runDepProbe, visibleMetas, requires]);

  /* 可见引擎集确定后,每引擎拉一次最新版本(模块级 latest 去重:每次应用运行
     一次;失败不占名额,下次回首页重试)。手动刷新(refreshTick > 0)绕过去重
     与 5 分钟 TTL 强制重拉。 */
  useEffect(() => {
    const force = refreshTick > 0;
    for (const meta of visibleMetas) {
      if (!meta.npmPackage) continue;
      if (!force && latestFetched.has(meta.id)) continue;
      latestFetched.add(meta.id);
      void fetchLatestVersion(meta.npmPackage, { force }).then((version) => {
        if (version === null) {
          latestFetched.delete(meta.id);
          return;
        }
        latestCache.set(meta.id, version);
        setLatest((prev) => ({ ...prev, [meta.id]: version }));
      });
    }
  }, [visibleMetas, refreshTick]);

  /* 凭据盘点:引擎集变化时每引擎拉一次(供应商额度 HTTP,缓存先上屏后台刷新;
     listEngineCredentials 内部已容错,此处 catch 是最后防线:单引擎失败不产生
     unhandled rejection)。手动刷新经 refreshTick 重跑。 */
  useEffect(() => {
    let alive = true;
    for (const meta of visibleMetas) {
      void listEngineCredentials(meta.id)
        .then((list) => {
          credsCache.set(meta.id, list);
          if (alive) setCredsMap((prev) => ({ ...prev, [meta.id]: list }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [visibleMetas, refreshTick]);

  /* 手动全量刷新(标题条按钮):重探全部引擎与前置依赖(落 loading 可见),
     最新版/凭据/页脚 RESUME 重扫/TOKENS 重扫经 refreshTick 重跑 effect 静默续拉。 */
  const refreshAll = useCallback(() => {
    for (const meta of visibleMetas) void runProbe(meta.id, true);
    for (const req of requires) void runDepProbe(req.binary, true);
    setRefreshTick((n) => n + 1);
  }, [visibleMetas, requires, runProbe, runDepProbe]);

  const installedCount = visibleMetas.filter(
    (m) => probes[m.id]?.status === "ok",
  ).length;
  const outdatedCount = visibleMetas.filter(
    (m) =>
      probes[m.id]?.status === "ok" &&
      isOutdated(probes[m.id]?.result?.version, latest[m.id] ?? null),
  ).length;
  const refreshing = visibleMetas.some((m) => probes[m.id]?.status === "loading");

  const toggleExpand = useCallback((engineId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(engineId)) next.delete(engineId);
      else next.add(engineId);
      return next;
    });
  }, []);

  /* 以 prompt 行选中工作区启动引擎新会话;spawn 被拒原因已由内核广播
     sessionStartFailed(toast 呈现),此处只吞 rejection(对齐 SessionMenu 先例)。 */
  const spawnSession = useCallback(
    (engineId: string) => {
      if (!ws) return;
      void host.createSession(engineId, ws.root, ws.id).catch(() => undefined);
    },
    [ws],
  );

  /* 键盘游标:↑↓ 移动(滚动跟随),⏎ 启动游标引擎新会话(仅已安装)。 */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return;
      /* 工作区 select 聚焦时让位于原生键盘行为。 */
      if ((e.target as HTMLElement).tagName === "SELECT") return;
      e.preventDefault();
      if (e.key === "Enter") {
        const meta = visibleMetas[cursor];
        if (meta && probes[meta.id]?.status === "ok") spawnSession(meta.id);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(Math.max(cursor + delta, 0), visibleMetas.length - 1);
      if (next === cursor) return;
      setCursor(next);
      scrollRef.current
        ?.querySelectorAll(".welcome-row")
        ?.[next]
        ?.scrollIntoView({ block: "nearest" });
    },
    [visibleMetas, cursor, probes, spawnSession],
  );

  return (
    <div className="welcome-page">
      {/* 终端式首页:↑↓/⏎ 自定义游标(本容器 onKeyDown),listbox/option 语义对应行游标。 */}
      <div
        className="welcome-scroll welcome-mono"
        ref={scrollRef}
        role="listbox"
        aria-label={t("引擎选择器")}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <WelcomeTbar refreshing={refreshing} onRefresh={refreshAll} />
        <div className="welcome-frame">

          <div className="welcome-promptline">
            <span className="prompt">
              <span className="path">{ws ? shortenHome(ws.root, home) : "~"}</span> ❯
            </span>
            <select
              className="welcome-ws-select"
              value={ws?.id ?? ""}
              onChange={(e) => setWsId(e.target.value)}
              title={t("新会话的工作区")}
              aria-label={t("工作区")}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id} title={w.root}>
                  {workspaceDisplayName(w)}
                </option>
              ))}
            </select>
            <span className="welcome-statusline">
              <span>
                engines{" "}
                <b className={installedCount === visibleMetas.length ? "ok" : "warn"}>
                  {installedCount}/{visibleMetas.length}
                </b>
              </span>
              {outdatedCount > 0 && (
                <span>updates <b className="warn">{outdatedCount}</b></span>
              )}
            </span>
          </div>

          <div className="welcome-rows">
            {visibleMetas.map((meta, index) => (
              <EngineSection
                key={meta.id}
                meta={meta}
                probe={probes[meta.id] ?? { status: "loading", result: null }}
                depProbe={meta.requires ? depProbes[meta.requires.binary] : undefined}
                latest={latest[meta.id]}
                creds={credsMap[meta.id]}
                expanded={expanded.has(meta.id)}
                onToggleExpand={() => toggleExpand(meta.id)}
                cursor={visibleMetas[cursor]?.id === meta.id}
                onCursor={() => setCursor(index)}
                onProbe={() => void runProbe(meta.id, true)}
                onDepProbe={(binary) => void runDepProbe(binary)}
                onNewSession={() => spawnSession(meta.id)}
              />
            ))}
          </div>
          <WelcomeFooter credsMap={credsMap} refreshTick={refreshTick} />
          <TokenDashboard refreshTick={refreshTick} />
          {/* 页尾跨引擎面板(WSL 主机卡等插件贡献;welcome.footer 挂点) */}
          <Mounts point="welcome.footer" />
        </div>
      </div>
    </div>
  );
}
