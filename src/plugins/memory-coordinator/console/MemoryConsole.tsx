/**
 * Memory 控制台 —— 中央编辑区(EditorCenter 位)的池可视化与配置入口。
 *
 * 功能区(全部收敛于此,不进设置页):启用 + 安装/迁移(bootstrap)、
 * 引擎配置卡(上游 jsonc 实证项)、读取侧(胶囊注入策略)、统计、最近沉淀、
 * 写入(手动添加 / 沉淀最近 omp 会话,经 d 路 omp 官方管线)。
 * 各功能区卡片拆至 MemoryConsoleCards.tsx(文件规模铁则)。
 */

import { useCallback, useEffect, useReducer } from "react";
import type { EditorTab } from "@kernel/tabs";
import { ipc } from "@kernel/ipc";
import { useWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { type MemoryItem } from "../protocol";
import { memoryPool, resolveProjectIdentity } from "../pool";
import { EngineConfigCard } from "./EngineConfigCard";
import { readEngineConfigFile, writeEngineConfigFile, type EngineConfig } from "./engineConfigModel";
import { engineConfigPath } from "../paths";
import { InstallCard } from "./InstallCard";
import {
  DistillSettingsCard,
  ReadSettingsCard,
  WriteCard,
} from "./MemoryConsoleCards";
import { RecentCard, StatsCard } from "./MemoryConsoleStats";

/* ── 面板状态机(reducer 模块级;各卡共同消费一份池/引擎状态) ── */
type ConsoleState = {
  ready: boolean | null;
  poolReason: "not-installed" | "locked" | null;
  identity: string | null;
  counts: { total: number; week: number; byHarness: [string, number][] } | null;
  lastDream: string | null;
  recent: MemoryItem[];
  engine: EngineConfig | null;
  engineDirty: boolean;
  engineSaving: boolean;
  configHint: string | null;
};

const initialConsoleState: ConsoleState = {
  ready: null,
  poolReason: null,
  identity: null,
  counts: null,
  lastDream: null,
  recent: [],
  engine: null,
  engineDirty: false,
  engineSaving: false,
  configHint: null,
};

type ConsoleAction = { type: "patch"; patch: Partial<ConsoleState> };

function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  return { ...state, ...action.patch };
}

export function MemoryConsole(_props: { tab: EditorTab }) {
  const workspaces = useWorkspaces();
  const root = workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? "";

  const [st, dispatch] = useReducer(consoleReducer, initialConsoleState);
  const patch = useCallback((p: Partial<ConsoleState>) => dispatch({ type: "patch", patch: p }), []);

  const reload = useCallback(async () => {
    if (!root) return;
    const id = await resolveProjectIdentity(root);
    patch({ identity: id });
    if (!id) return;
    const pool = await memoryPool.status();
    patch({ ready: pool.ready, poolReason: pool.reason ?? null });
    if (!pool.ready) return;
    const dbPath = pool.dbPath ?? "";
    const items = await memoryPool.recall(id, undefined, 200);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const week = items.filter((m) => m.createdAt >= weekAgo).length;
    const byHarness = new Map<string, number>();
    for (const m of items) {
      const k = m.harness || "pi";
      byHarness.set(k, (byHarness.get(k) ?? 0) + 1);
    }
    patch({ recent: items.slice(0, 12), counts: { total: pool.count, week, byHarness: [...byHarness.entries()] } });
    try {
      const rows = await ipc.sqliteQuery(dbPath, "SELECT max(finished_at) FROM dream_runs", []);
      const ts = Number(rows[0]?.[0] ?? 0);
      patch({ lastDream: ts > 0 ? new Date(ts).toLocaleString("zh-CN") : null });
    } catch {
      patch({ lastDream: null });
    }
  }, [root, patch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await engineConfigPath();
        await ipc.fsReadFile(p);
        if (!cancelled) patch({ configHint: null });
      } catch (e) {
        if (!cancelled) patch({ configHint: t("引擎配置读取失败: {err}", { err: String(e).slice(0, 120) }) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patch]);

  const saveEngine = async () => {
    if (!st.engine) return;
    patch({ engineSaving: true });
    try {
      const { original } = await readEngineConfigFile();
      await writeEngineConfigFile(st.engine, original);
      patch({ engineDirty: false });
    } finally {
      patch({ engineSaving: false });
    }
  };

  /* 池不可用横幅:未安装(库缺失/未迁移)与被占用(真·迁移窗口)分开表述,
  避免全新机器上一律误报「迁移窗口」。 */
  const poolUnavailableText =
    st.poolReason === "locked"
      ? t("共享记忆库暂不可读(可能处于迁移窗口:关闭全部 omp/pi 会话后重开即可)。session / composer / approvals 不受影响。")
      : t("共享记忆库尚未初始化(Magic Context 未安装或未迁移),在下方安装卡完成安装与迁移即可。session / composer / approvals 不受影响。");

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-(--tmd-bg-base) p-3 text-[0.75rem] text-(--tmd-fg)">
      <div className="mb-3 flex min-w-0 flex-none items-center gap-2.5">
        <span className="text-sm font-semibold">{t("Memory 控制台")}</span>
        {st.ready !== null && (
          <span className={`rounded-full px-2 py-px text-[0.625rem] ${st.ready ? "text-(--tmd-ok)" : "text-(--tmd-err)"}`}>
            {st.ready ? t("池就绪") : t("池不可用")}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-(--tmd-fg-faint)">{t("Magic Context · 本地 SQLite")}</span>
      </div>

      {st.ready === false && (
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
      {st.configHint && (
        <div className="mb-2 rounded-md border border-(--tmd-warn) bg-(--tmd-bg-elevated) p-2 text-[0.65625rem] text-(--tmd-warn)">
          {st.configHint}
        </div>
      )}
      {st.engine && (
        <div className="mb-3">
          <EngineConfigCard
            config={st.engine}
            dirty={st.engineDirty}
            saving={st.engineSaving}
            onChange={(next) => patch({ engine: next, engineDirty: true })}
            onSave={() => void saveEngine()}
          />
        </div>
      )}

      {/* ── 读取设置(本客户端) ── */}
      <ReadSettingsCard />

      {/* ── 写入(d 路) ── */}
      <WriteCard root={root} visible={Boolean(st.ready && st.identity)} onWritten={() => void reload()} />

      {/* ── 沉淀设置(自动沉淀开关 + 提炼配置;自动与手动共用) ── */}
      <DistillSettingsCard />

      {/* ── 统计 ── */}
      {st.counts && st.identity && <StatsCard counts={st.counts} lastDream={st.lastDream} />}

      {/* ── 最近沉淀 ── */}
      {st.counts && st.identity && <RecentCard recent={st.recent} />}
    </div>
  );
}
