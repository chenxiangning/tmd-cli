/**
 * Memory 控制台功能区卡片 —— 自 MemoryConsole.tsx 拆出(文件规模铁则)。
 *
 * 读取设置(胶囊注入策略)/ 写入(d 路手动添加 + 沉淀所选 omp 会话)/
 * 沉淀设置(自动开关 + 代写引擎/提炼模型/补充规则)。
 * 统计与最近沉淀卡拆至 MemoryConsoleStats.tsx。
 * 写入一律经 omp 官方管线(rememberFacts / distillSessionTail),不直写数据库。
 */

import { useEffect, useState } from "react";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { host, useHost } from "@kernel/host";
import { listModels, type ModelEngine } from "../modelCatalog";
import { rememberFacts, distillSessionTail } from "../phase2/write";

/** 控制台共用输入框样式(与主文件同源,勿分叉)。 */
export const consoleInputCls =
  "h-7 flex-1 min-w-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 font-mono text-[11px] text-(--tmd-fg) outline-none focus:border-(--tmd-accent)";
/** 控制台共用卡片容器样式。 */
export const consoleCardCls =
  "rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3";

/** ── 读取设置(本客户端):只影响 tmd-cli 展示,不改动上游数据 ── */
export function ReadSettingsCard() {
  const { settings } = useSettingsState();
  return (
    <div className={`mb-3 ${consoleCardCls}`}>
      <div className="mb-0.5 text-[11.5px] font-semibold">读取设置(本客户端)</div>
      <div className="mb-2 text-[10px] text-(--tmd-fg-faint)">
        以下只影响 tmd-cli 如何给你展示记忆,不改动上游数据。
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-20 flex-none text-[11px] text-(--tmd-fg-muted)">胶囊注入</span>
        <select
          className={consoleInputCls}
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
  );
}

/** ── 写入(d 路):手动一条 + 沉淀所选 omp 会话最近 10 条用户消息 ── */
export function WriteCard({
  root,
  visible,
  onWritten,
}: {
  root: string;
  /** 池就绪且身份已解析才展示(对应主文件 ready && identity 条件)。 */
  visible: boolean;
  onWritten: () => void;
}) {
  useHost();
  const { settings } = useSettingsState();
  const [newContent, setNewContent] = useState("");
  const [distillState, setDistillState] = useState<string | null>(null);
  const [distillTarget, setDistillTarget] = useState<string | null>(null);
  const [distillRunning, setDistillRunning] = useState(false);
  const ompSessions = host
    .getSessions()
    .filter((s2) => s2.profileId === "omp")
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  useEffect(() => {
    if (!distillTarget && ompSessions.length > 0) setDistillTarget(ompSessions[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ompSessions.length]);

  if (!visible) return null;

  return (
    <div className={`mb-3 ${consoleCardCls}`}>
      <div className="mb-0.5 text-[11.5px] font-semibold">写入记忆</div>
      <div className="mb-2 text-[10px] text-(--tmd-fg-faint)">
        所有写入由 omp 引擎代为执行(与上游自身沉淀同一条管线,数据始终一致;tmd-cli 不直写数据库)。
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <input
          className={consoleInputCls}
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
                  onWritten();
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
                onWritten();
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
  );
}

/** ── 沉淀设置:自动沉淀开关 + 提炼配置(自动与手动共用) ── */
export function DistillSettingsCard() {
  const { settings } = useSettingsState();
  const distillEngine = settings.memoryDistillEngine as ModelEngine;
  const [distillModels, setDistillModels] = useState<{ selector: string }[]>([]);
  const [distillModelsLoading, setDistillModelsLoading] = useState(true);

  useEffect(() => {
    setDistillModelsLoading(true);
    void listModels(distillEngine).then((m) => {
      setDistillModels(m);
      setDistillModelsLoading(false);
    });
  }, [distillEngine]);

  return (
    <div className={`mb-3 ${consoleCardCls}`}>
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
            className={`${consoleInputCls} cursor-pointer`}
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
              className={`${consoleInputCls} cursor-pointer`}
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
              className={consoleInputCls}
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
            className={consoleInputCls}
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
  );
}

