/**
 * Memory 控制台 —— 中央编辑区(EditorCenter 位)的池可视化与配置入口。
 *
 * 功能区(全部收敛于此,不进设置页):启用 + 安装/迁移(bootstrap)、
 * 引擎配置卡(上游 jsonc 实证项)、读取侧(胶囊注入策略)、统计、最近沉淀、
 * 写入(手动添加 / 沉淀最近 omp 会话,经 d 路 omp 官方管线)。
 * 各功能区卡片拆至 MemoryConsoleCards.tsx(文件规模铁则)。
 */

import { useCallback, useEffect, useState } from "react";
import type { EditorTab } from "@kernel/tabs";
import { ipc } from "@kernel/ipc";
import { closeTab, getTabs, openTab } from "@kernel/tabs";
import { useWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { type MemoryItem } from "../protocol";
import { memoryPool, resolveProjectIdentity } from "../pool";
import { EngineConfigCard, readEngineConfigFile, writeEngineConfigFile, type EngineConfig } from "./EngineConfigCard";
import { engineConfigPath } from "../paths";
import { InstallCard } from "./InstallCard";
import {
  DistillSettingsCard,
  ReadSettingsCard,
  WriteCard,
} from "./MemoryConsoleCards";
import { RecentCard, StatsCard } from "./MemoryConsoleStats";

/** 面板/入口打开控制台(唯一定义,避免循环依赖)。 */
export function openConsoleTab(): void {
  openTab({
    id: "memory-console",
    title: t("Memory 控制台"),
    path: "Magic Context",
    kind: "memory-console",
    payload: {},
  });
}

/** 已打开则关闭,未打开则打开(面板底部切换按钮)。 */
export function toggleConsoleTab(): void {
  if (getTabs().some((t) => t.id === "memory-console")) closeTab("memory-console");
  else openConsoleTab();
}

export function MemoryConsole(_props: { tab: EditorTab }) {
  const workspaces = useWorkspaces();
  const root = workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? "";

  const [ready, setReady] = useState<boolean | null>(null);
  const [poolReason, setPoolReason] = useState<"not-installed" | "locked" | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ total: number; week: number; byHarness: [string, number][] } | null>(null);
  const [lastDream, setLastDream] = useState<string | null>(null);
  const [recent, setRecent] = useState<MemoryItem[]>([]);
  const [engine, setEngine] = useState<EngineConfig | null>(null);
  const [engineDirty, setEngineDirty] = useState(false);
  const [engineSaving, setEngineSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!root) return;
    const id = await resolveProjectIdentity(root);
    setIdentity(id);
    if (!id) return;
    const st = await memoryPool.status();
    setReady(st.ready);
    setPoolReason(st.reason ?? null);
    if (!st.ready) return;
    const dbPath = st.dbPath ?? "";
    const items = await memoryPool.recall(id, undefined, 200);
    setRecent(items.slice(0, 12));
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const week = items.filter((m) => m.createdAt >= weekAgo).length;
    const byHarness = new Map<string, number>();
    for (const m of items) {
      const k = m.harness || "pi";
      byHarness.set(k, (byHarness.get(k) ?? 0) + 1);
    }
    setCounts({ total: st.count, week, byHarness: [...byHarness.entries()] });
    try {
      const rows = await ipc.sqliteQuery(dbPath, "SELECT max(finished_at) FROM dream_runs", []);
      const ts = Number(rows[0]?.[0] ?? 0);
      setLastDream(ts > 0 ? new Date(ts).toLocaleString("zh-CN") : null);
    } catch {
      setLastDream(null);
    }
  }, [root]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const [configHint, setConfigHint] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await engineConfigPath();
        await ipc.fsReadFile(p);
        if (!cancelled) setConfigHint(null);
      } catch (e) {
        if (!cancelled) setConfigHint(t("引擎配置读取失败: {err}", { err: String(e).slice(0, 120) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveEngine = async () => {
    if (!engine) return;
    setEngineSaving(true);
    try {
      const { original } = await readEngineConfigFile();
      await writeEngineConfigFile(engine, original);
      setEngineDirty(false);
    } finally {
      setEngineSaving(false);
    }
  };

  /* 池不可用横幅:未安装(库缺失/未迁移)与被占用(真·迁移窗口)分开表述,
  避免全新机器上一律误报「迁移窗口」。 */
  const poolUnavailableText =
    poolReason === "locked"
      ? t("共享记忆库暂不可读(可能处于迁移窗口:关闭全部 omp/pi 会话后重开即可)。session / composer / approvals 不受影响。")
      : t("共享记忆库尚未初始化(Magic Context 未安装或未迁移),在下方安装卡完成安装与迁移即可。session / composer / approvals 不受影响。");

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-(--tmd-bg-base) p-3 text-[0.75rem] text-(--tmd-fg)">
      <div className="mb-3 flex min-w-0 flex-none items-center gap-2.5">
        <span className="text-sm font-semibold">{t("Memory 控制台")}</span>
        {ready !== null && (
          <span className={`rounded-full px-2 py-px text-[0.625rem] ${ready ? "text-(--tmd-ok)" : "text-(--tmd-err)"}`}>
            {ready ? t("池就绪") : t("池不可用")}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-(--tmd-fg-faint)">{t("Magic Context · 本地 SQLite")}</span>
      </div>

      {ready === false && (
        <div
          className="mb-3 truncate rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3 text-[0.6875rem] text-(--tmd-fg-muted)"
          title={poolUnavailableText}
        >
          {poolUnavailableText}
        </div>
      )}
      {/* ── 启用 + 三 harness 安装/迁移(InstallCard) ── */}
      <InstallCard onInstalled={() => void reload()} />
      {/* ── 引擎配置 ── */}
      {configHint && (
        <div className="mb-2 rounded-md border border-(--tmd-warn) bg-(--tmd-bg-elevated) p-2 text-[0.65625rem] text-(--tmd-warn)">
          {configHint}
        </div>
      )}
      {engine && (
        <div className="mb-3">
          <EngineConfigCard
            config={engine}
            dirty={engineDirty}
            saving={engineSaving}
            onChange={(next) => {
              setEngine(next);
              setEngineDirty(true);
            }}
            onSave={() => void saveEngine()}
          />
        </div>
      )}

      {/* ── 读取设置(本客户端) ── */}
      <ReadSettingsCard />

      {/* ── 写入(d 路) ── */}
      <WriteCard root={root} visible={Boolean(ready && identity)} onWritten={() => void reload()} />

      {/* ── 沉淀设置(自动沉淀开关 + 提炼配置;自动与手动共用) ── */}
      <DistillSettingsCard />

      {/* ── 统计 ── */}
      {counts && identity && <StatsCard counts={counts} lastDream={lastDream} />}

      {/* ── 最近沉淀 ── */}
      {counts && identity && <RecentCard recent={recent} />}
    </div>
  );
}
