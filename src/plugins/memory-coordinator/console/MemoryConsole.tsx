/**
 * Memory 控制台 —— 中央编辑区(EditorCenter 位)的池可视化与配置入口。
 *
 * 功能区(全部收敛于此,不进设置页):启用 + 安装/迁移(bootstrap)、
 * 引擎配置卡(上游 jsonc 实证项)、读取侧(胶囊注入策略)、统计、最近沉淀、
 * 写入(手动添加 / 沉淀最近 omp 会话,经 d 路 omp 官方管线)。
 */

import { useCallback, useEffect, useState } from "react";
import type { EditorTab } from "@kernel/tabs";
import { ipc } from "@kernel/ipc";
import { closeTab, getTabs, openTab } from "@kernel/tabs";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { useWorkspaces } from "@kernel/workspace";
import { host, useHost } from "@kernel/host";
import { listModels, type ModelEngine } from "../modelCatalog";
import { CATEGORY_CN, type MemoryItem } from "../protocol";
import { memoryPool, resolveProjectIdentity } from "../pool";
import { rememberFacts, distillSessionTail } from "../phase2/write";
import { EngineConfigCard, readEngineConfigFile, writeEngineConfigFile, type EngineConfig } from "./EngineConfigCard";
import { engineConfigPath } from "../paths";
import { InstallCard } from "./InstallCard";

/** 面板/入口打开控制台(唯一定义,避免循环依赖)。 */
export function openConsoleTab(): void {
  openTab({
    id: "memory-console",
    title: "Memory 控制台",
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

function categoryLabel(key: string): string {
  return (CATEGORY_CN as Record<string, string>)[key] ?? key;
}

export function MemoryConsole(_props: { tab: EditorTab }) {
  useHost();
  const { settings } = useSettingsState();
  const workspaces = useWorkspaces();
  const root = workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? "";

  const [ready, setReady] = useState<boolean | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ total: number; week: number; byHarness: [string, number][] } | null>(null);
  const [lastDream, setLastDream] = useState<string | null>(null);
  const [recent, setRecent] = useState<MemoryItem[]>([]);
  const [engine, setEngine] = useState<EngineConfig | null>(null);
  const [engineDirty, setEngineDirty] = useState(false);
  const [engineSaving, setEngineSaving] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [distillState, setDistillState] = useState<string | null>(null);
  const [distillTarget, setDistillTarget] = useState<string | null>(null);
  const distillEngine = settings.memoryDistillEngine as ModelEngine;
  const [distillModels, setDistillModels] = useState<{ selector: string }[]>([]);
  const [distillModelsLoading, setDistillModelsLoading] = useState(true);
  const [distillRunning, setDistillRunning] = useState(false);
  const ompSessions = host
    .getSessions()
    .filter((s2) => s2.profileId === "omp")
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const reload = useCallback(async () => {
    if (!root) return;
    const id = await resolveProjectIdentity(root);
    setIdentity(id);
    if (!id) return;
    const st = await memoryPool.status();
    setReady(st.ready);
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

  useEffect(() => {
    if (!distillTarget && ompSessions.length > 0) setDistillTarget(ompSessions[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ompSessions.length]);

  const [configHint, setConfigHint] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await engineConfigPath();
        await ipc.fsReadFile(p);
        if (!cancelled) setConfigHint(null);
      } catch (e) {
        if (!cancelled) setConfigHint("引擎配置读取失败: " + String(e).slice(0, 120));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDistillModelsLoading(true);
    void listModels(distillEngine).then((m) => {
      setDistillModels(m);
      setDistillModelsLoading(false);
    });
  }, [distillEngine]);

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

  const inputCls =
    "h-7 flex-1 min-w-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 font-mono text-[11px] text-(--tmd-fg) outline-none focus:border-(--tmd-accent)";
  const card = "rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3";

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-(--tmd-bg-base) p-3 text-[12px] text-(--tmd-fg)">
      <div className="mb-3 flex min-w-0 flex-none items-center gap-2.5">
        <span className="text-sm font-semibold">Memory 控制台</span>
        {ready !== null && (
          <span className={`rounded-full px-2 py-px text-[10px] ${ready ? "text-(--tmd-ok)" : "text-(--tmd-err)"}`}>
            {ready ? "池就绪" : "池不可用"}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-(--tmd-fg-faint)">Magic Context · 本地 SQLite</span>
      </div>

      {ready === false && (
        <div
          className="mb-3 truncate rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3 text-[11px] text-(--tmd-fg-muted)"
          title="共享记忆库暂不可读(可能处于迁移窗口:关闭全部 omp/pi 会话后重开即可)。session / composer / approvals 不受影响。"
        >
          共享记忆库暂不可读(可能处于迁移窗口:关闭全部 omp/pi 会话后重开即可)。session / composer / approvals 不受影响。
        </div>
      )}

      {/* ── 启用 + 三 harness 安装/迁移(InstallCard) ── */}
      <InstallCard onInstalled={() => void reload()} />
      {/* ── 引擎配置 ── */}
      {configHint && (
        <div className="mb-2 rounded-md border border-(--tmd-warn) bg-(--tmd-bg-elevated) p-2 text-[10.5px] text-(--tmd-warn)">
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
      <div className={`mb-3 ${card}`}>
        <div className="mb-0.5 text-[11.5px] font-semibold">读取设置(本客户端)</div>
        <div className="mb-2 text-[10px] text-(--tmd-fg-faint)">
          以下只影响 tmd-cli 如何给你展示记忆,不改动上游数据。
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-20 flex-none text-[11px] text-(--tmd-fg-muted)">胶囊注入</span>
          <select
            className={inputCls}
            value={settings.memoryCapsuleMode}
            onChange={(e) => updateSettings({ memoryCapsuleMode: e.target.value as never })}
          >
            <option value="manual">手动确认后注入(默认)</option>
            <option value="auto">新会话自动展开</option>
            <option value="off">关闭胶囊</option>
          </select>
        </div>
        <div className="mt-0.5 truncate pl-[88px] text-[10px] text-(--tmd-fg-faint)">
          claude/codex/grok/kimi/qoder 的新会话顶部出现「项目记忆」胶囊:手动=点开勾选后注入;自动=出现即展开;关闭=不显示。omp/pi 原生注入,不受此项影响。
        </div>
      </div>

      {/* ── 写入(d 路) ── */}
      {ready && identity && (
        <div className={`mb-3 ${card}`}>
          <div className="mb-0.5 text-[11.5px] font-semibold">写入记忆</div>
          <div className="mb-2 text-[10px] text-(--tmd-fg-faint)">
            所有写入由 omp 引擎代为执行(与上游自身沉淀同一条管线,数据始终一致;tmd-cli 不直写数据库)。
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <input
              className={inputCls}
              placeholder="手动写一条记忆(回车保存,类目=约束)…"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newContent.trim()) {
                  void rememberFacts([{ category: "CONSTRAINTS", content: newContent.trim() }], root, {
                      model: settings.memoryDistillModel || undefined,
                    }).then(
                    (out) => {
                      setNewContent("");
                      setDistillState(out.ok ? "已写入" : `失败: ${out.detail}`);
                      void reload();
                    },
                  );
                }
              }}
            />
          </div>
          <div className="mt-0.5 truncate pl-1 text-[10px] text-(--tmd-fg-faint)">
            直接写一条固定记忆(类目=约束),回车立即入库,全部引擎可见。
          </div>
          <div className="mt-2 flex flex-none items-center gap-2 overflow-x-auto">
            <select
              className="h-7 min-w-0 max-w-[220px] flex-1 cursor-pointer rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 text-[11px] text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
              value={distillTarget ?? ""}
              onChange={(e) => setDistillTarget(e.target.value || null)}
              title="选择要沉淀的 omp 会话(取其最近 10 条用户消息提炼入库)"
            >
              {ompSessions.length === 0 && <option value="">无 omp 会话</option>}
              {ompSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  omp · {s.title || s.id.slice(0, 8)} ·{" "}
                  {s.createdAt ? new Date(s.createdAt).toLocaleString("zh-CN") : ""}
                </option>
              ))}
            </select>
            <button
              className="flex-none rounded-md border border-(--tmd-border) px-2.5 py-1 text-[11px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg) disabled:opacity-45"
              disabled={!distillTarget || distillRunning}
              onClick={() => {
                const target = ompSessions.find((s) => s.id === distillTarget);
                if (!target) return;
                setDistillRunning(true);
                setDistillState("提炼中…(omp 模型逐条写入)");
                void (async () => {
                  try {
                    const cliSessionId = host.getCliSessionId(target.id) ?? "";
                    const profile = host.getCliProfile("omp");
                    const readMsgs = profile?.readSessionUserMessages;
                    if (!readMsgs) {
                      setDistillState("该 omp 版本不支持会话消息读取");
                      return;
                    }
                    const msgs = await readMsgs(target.cwd, cliSessionId, true);
                    const tail = (msgs ?? [])
                      .slice(-10)
                      .map((m) => m.text)
                      .join("\n---\n")
                      .slice(-6000);
                    if (!tail) {
                      setDistillState("该会话没有可提炼的用户消息");
                      return;
                    }
                    const out = await distillSessionTail(tail, target.cwd, {
                      model: settings.memoryDistillModel || undefined,
                      extraRules: settings.memoryDistillRules || undefined,
                      engine: settings.memoryDistillEngine,
                    });
                    setDistillState(out.ok ? "提炼完成" : `失败: ${out.detail}`);
                    void reload();
                  } finally {
                    setDistillRunning(false);
                  }
                })();
              }}
            >
              {distillRunning ? "沉淀中…" : "沉淀所选会话"}
            </button>
          </div>
          <div className="mt-0.5 truncate pl-1 text-[10px] text-(--tmd-fg-faint)" title="把所选 omp 会话最近 10 条用户消息交给 omp 模型提炼:值得长期记住的(规则/约束/偏好)逐条入库,闲聊忽略">
            把所选 omp 会话最近 10 条用户消息交给 omp 模型提炼入库(规则/约束/偏好保留,闲聊忽略)。
          </div>
          {distillState && (
            <div className="mt-1 truncate text-[10.5px] text-(--tmd-fg-subtle)">{distillState}</div>
          )}

        </div>
      )}

      {/* ── 沉淀设置(自动沉淀开关 + 提炼配置;自动与手动共用) ── */}
      <div className={`mb-3 ${card}`}>
        <div className="mb-0.5 text-[11.5px] font-semibold">沉淀设置</div>
        <div className="mb-2 text-[10px] text-(--tmd-fg-faint)">
          自动沉淀开关与提炼配置;引擎/模型/规则同时作用于会话结束的自动沉淀与「沉淀所选会话」。
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-20 flex-none text-[11px] text-(--tmd-fg-muted)">自动沉淀</span>
          <button
            className={`relative h-5 w-[30px] flex-none rounded-full border ${
              settings.memoryAutoDistill
                ? "border-(--tmd-accent) bg-(--tmd-accent-soft)"
                : "border-(--tmd-border-strong) bg-(--tmd-bg-input)"
            }`}
            onClick={() => updateSettings({ memoryAutoDistill: !settings.memoryAutoDistill })}
          >
            <span
              className={`absolute top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full ${
                settings.memoryAutoDistill ? "left-[14px] bg-(--tmd-accent)" : "left-[2px] bg-(--tmd-fg-faint)"
              }`}
            />
          </button>
        </div>
        <div className="mt-0.5 truncate pl-[88px] text-[10px] text-(--tmd-fg-faint)" title="omp 会话结束 → 自动提炼该会话用户消息 → 记忆入库;默认关闭,开启后每次会话结束多一次小模型调用">
          omp 会话结束时,自动把它里面你说过的话提炼成记忆入库(默认关;开启后每次会话结束多一次小模型调用)
        </div>
        <div className="mt-3 border-t border-(--tmd-border) pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="w-20 flex-none text-[11px] text-(--tmd-fg-muted)" title="由哪个引擎的会话代为执行写入(三家插件都注册 ctx_memory,写的是同一个记忆库)">代写引擎</span>
            <select
              className={`${inputCls} cursor-pointer`}
              value={settings.memoryDistillEngine}
              onChange={(e) => updateSettings({ memoryDistillEngine: e.target.value as never })}
            >
              <option value="omp">omp(默认)</option>
              <option value="pi">pi</option>
              <option value="opencode">opencode</option>
            </select>
          </div>
          <div className="mt-0.5 truncate pl-[88px] text-[10px] text-(--tmd-fg-faint)">
            由该引擎代为执行写入(需已安装对应插件);三家写入同一条官方管线与记忆库。
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="w-20 flex-none text-[11px] text-(--tmd-fg-muted)">提炼模型</span>
            {distillModels.length > 0 ? (
              <select
                className={`${inputCls} cursor-pointer`}
                value={settings.memoryDistillModel}
                onChange={(e) => updateSettings({ memoryDistillModel: e.target.value })}
                title={`沉淀提炼用的模型,列表实时取自 ${distillEngine};跟随默认 = 该引擎当前默认模型`}
              >
                <option value="">跟随 {distillEngine} 默认模型</option>
                {distillModels.map((m) => (
                  <option key={m.selector} value={m.selector}>{m.selector}</option>
                ))}
              </select>
            ) : (
              <input
                className={inputCls}
                placeholder={distillModelsLoading ? "拉取模型列表中…" : `${distillEngine} 无列表命令,手动填 provider/model`}
                value={settings.memoryDistillModel}
                onChange={(e) => updateSettings({ memoryDistillModel: e.target.value })}
              />
            )}
          </div>
          <div className="mt-0.5 truncate pl-[88px] text-[10px] text-(--tmd-fg-faint)">
            列表实时取自 {distillEngine} 可用模型;仅作用于沉淀提炼,选便宜快的即可。
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="w-20 flex-none text-[11px] text-(--tmd-fg-muted)">补充规则</span>
            <input
              className={inputCls}
              placeholder="如:特别记住数据库决定;忽略测试细节(留空 = 默认规则)"
              value={settings.memoryDistillRules}
              onChange={(e) => updateSettings({ memoryDistillRules: e.target.value })}
            />
          </div>
          <div className="mt-0.5 truncate pl-[88px] text-[10px] text-(--tmd-fg-faint)">
            追加到提炼指令,优先遵循;默认规则=记规则/架构/约束/配置/命名/偏好,忽略一次性请求与闲聊。
          </div>
        </div>
      </div>
      {/* ── 统计 ── */}
      {counts && identity && (
        <div className={`mb-3 ${card}`}>
          <div className="mb-2 text-[11.5px] font-semibold">统计</div>
          <div className="mb-2 flex flex-wrap gap-6">
            <div>
              <div className="font-mono text-xl font-bold">{counts.total}</div>
              <div className="text-[10.5px] text-(--tmd-fg-faint)">记忆总数</div>
            </div>
            <div>
              <div className="font-mono text-xl font-bold">{counts.week}</div>
              <div className="text-[10.5px] text-(--tmd-fg-faint)">本周新增</div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {counts.byHarness.map(([name, n]) => (
              <div key={name} className="flex items-center gap-2">
                <span className="w-9 flex-none truncate text-[10.5px] text-(--tmd-fg-muted)">{name}</span>
                <span className="h-1.5 min-w-6 flex-1 overflow-hidden rounded-full bg-(--tmd-bg-input)">
                  <i
                    className="block h-full rounded-full bg-(--tmd-accent)"
                    style={{ width: `${Math.max(6, Math.round((n / counts.total) * 100))}%` }}
                  />
                </span>
                <span className="w-6 flex-none text-right font-mono text-[10.5px] text-(--tmd-fg-faint)">{n}</span>
              </div>
            ))}
          </div>
          {lastDream && <div className="mt-2 truncate text-[10.5px] text-(--tmd-fg-faint)">上次整理:{lastDream}</div>}
        </div>
      )}

      {/* ── 最近沉淀 ── */}
      {counts && identity && (
        <div className={card}>
          <div className="mb-2 text-[11.5px] font-semibold">最近沉淀</div>
          {recent.length === 0 ? (
            <div className="text-[11px] text-(--tmd-fg-faint)">无记录</div>
          ) : (
            recent.map((m) => (
              <div key={m.id} className="flex min-w-0 gap-2 border-b border-(--tmd-border) py-1 text-[11px] last:border-b-0">
                <span className="flex-none font-mono text-[10.5px] text-(--tmd-fg-faint)">
                  {new Date(m.updatedAt).toLocaleDateString("zh-CN")}
                </span>
                <span className="flex-none text-[10.5px] text-(--tmd-fg-subtle)">
                  {categoryLabel(m.category)}
                </span>
                <span className="min-w-0 flex-1 truncate text-(--tmd-fg-muted)">{m.content}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
