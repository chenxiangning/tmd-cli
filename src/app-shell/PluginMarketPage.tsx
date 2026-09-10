/**
 * 插件市场页(插排) —— 客户端 = 插排本体,插件 = 插头,点击插拔。
 *
 * 语义:插拔 = 启停插件,写 settings.disabledPlugins 持久化,重启后生效
 * (activateAll 组装时过滤);运行中不热卸载(避免 PTY/事件订阅泄漏)。
 * 核心插件(meta.category === "core")焊死不可拔。
 *
 * 布局:两块插排 —— 内置插件一块(分类虚线分隔 + 区内标签),本机插件(local 类)单独
 * 一块次级插排;清单列表与插排互斥切换(页头视图开关,同页只展示一份,淡入过渡)。
 *
 * 数据源:host.listPluginStates()(启动态) × settings.disabledPlugins(期望态),
 * 两者不一致 = dirty,展示"重启后生效"徽章。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, List, Plug, ArrowClockwise, Cross } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { getMarketPanel } from "@kernel/marketPanel";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { useLocalPluginRecords } from "@kernel/localPlugins";
import { appRestart } from "@kernel/ipc";
import { Mounts } from "@kernel/Mounts";
import { CATEGORY_ORDER, MergedStrip, type Row } from "./PluginMarketStrip";
import { PluginMarketList } from "./PluginMarketList";

export function PluginMarketPage({ onClose }: { onClose: () => void }) {
  /* 启动态清单:activateAll 完成后不再变化,取一次快照即可。 */
  const [states] = useState(() => host.listPluginStates());
  const { settings } = useSettingsState();
  const disabled = useMemo(
    () => new Set(settings.disabledPlugins),
    [settings.disabledPlugins],
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const rows: Row[] = states.map(({ plugin, enabled }) => {
    const on = !disabled.has(plugin.id);
    return { plugin, on, dirty: on !== enabled };
  });
  /* 按分类分排:固定顺序,空类不渲染(防御:现网三类均非空)。 */
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((r) => r.plugin.meta.category === category),
  })).filter((g) => g.rows.length > 0);
  /* 内置/本机拆两块插排:local 类单独拎出(本机插件插排),插拔语义不变。 */
  const builtinGroups = groups.filter((g) => g.category !== "local");
  const localGroups = groups.filter((g) => g.category === "local");
  /* 本机插排计数 = 已装本地插件(未移除记录);插排上的插头是管理器自身,不计入。 */
  const localInstalled = useLocalPluginRecords().filter((r) => !r.removed).length;
  const dirtyCount = rows.filter((r) => r.dirty).length;
  /* 插排视图 ⇄ 清单列表:互斥,同页只展示一份。 */
  const [view, setView] = useState<"strip" | "list">("strip");
  /* 二级市场滑出面板:marketFor = 打开面板的插件 id(目前仅 cli-omp 注册)。 */
  const [marketFor, setMarketFor] = useState<string | null>(null);
  const market = marketFor ? getMarketPanel(marketFor) : undefined;
  useEffect(() => {
    if (!market) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMarketFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [market]);

  /* Tauri 环境进程替换不返回;浏览器 dev invoke 抛错 → 降级整页刷新(同样重走 activateAll 过滤)。 */
  const restart = () => void appRestart().catch(() => window.location.reload());

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }

  function toggle(id: string) {
    const row = rows.find((r) => r.plugin.id === id);
    if (!row || row.plugin.meta.category === "core") return;
    const next = row.on
      ? [...settings.disabledPlugins, id]
      : settings.disabledPlugins.filter((x) => x !== id);
    updateSettings({ disabledPlugins: next });
    showToast(
      row.on
        ? t("已拔出 {id} —— 重启后从插排断电", { id })
        : t("已插入 {id} —— 重启后生效", { id }),
    );
  }

  return (
    <div className="pm-page">
      <div className="pm-inner">
        <div className="pm-head">
          <span className="pm-title">{t("插件市场")}</span>
          <span className="pm-sub">
            {t("客户端是插排,插件是插头 —— 插上即用,拔掉即停")}
          </span>
          <div className="pm-head-actions">
            <div className="pm-view-toggle" role="tablist" aria-label={t("视图切换")}>
              <button
                type="button"
                role="tab"
                aria-selected={view === "strip"}
                className={view === "strip" ? "active" : ""}
                title={t("插排视图")}
                onClick={() => setView("strip")}
              >
                <Plug size="0.75rem" aria-hidden />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "list"}
                className={view === "list" ? "active" : ""}
                title={t("列表视图")}
                onClick={() => setView("list")}
              >
                <List size="0.75rem" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              className={`pm-restart${dirtyCount > 0 ? " dirty" : ""}`}
              title={dirtyCount > 0 ? t("{n} 个插拔变更待重启生效", { n: dirtyCount }) : t("重启应用")}
              onClick={restart}
            >
              <ArrowClockwise size="0.75rem" aria-hidden />
              {t("重启应用")}{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
            </button>
            <button
              type="button"
              className="pm-close"
              aria-label={t("关闭插件市场")}
              title={t("关闭插件市场")}
              onClick={onClose}
            >
              <Cross size="0.875rem" aria-hidden />
            </button>
          </div>
        </div>

        {/* ═══ 主视图:插排 ⇄ 清单互斥(key 强制重挂载,淡入过渡) ═══ */}
        {view === "strip" ? (
          <div className="pm-view" key="strip">
            <MergedStrip groups={builtinGroups} onToggle={toggle} onOpenMarket={setMarketFor} />
            <div className="pm-strip-caption">
              <span>
                <span className="pm-legend-dot" style={{ background: "var(--tmd-accent)" }} />
                {t("已插入(运行中)")}
              </span>
              <span>
                <span className="pm-legend-dot" style={{ background: "var(--tmd-fg-faint)" }} />
                {t("已拔出(重启后生效)")}
              </span>
              <span>{t("焊死的核心插件不可拔")}</span>
              <span>{t("点击插头即可插拔")}</span>
            </div>
            {/* 本机插排与页尾分区同源:分区无本地插件(无未移除记录)时整条不渲染。 */}
            {localInstalled > 0 && (
              <MergedStrip
                groups={localGroups}
                onToggle={toggle}
                count={localInstalled}
                brand={{
                  name: t("本机插件"),
                  role: t("本地插排 · 免重启装载"),
                  master: t("对话即变 · 自动重扫"),
                }}
              />
            )}
          </div>
        ) : (
          <div className="pm-view" key="list">
            <PluginMarketList groups={groups} onToggle={toggle} />
          </div>
        )}
        {/* ═══ 本地插件分区(归 local-loader 插件贡献,经 market.local 挂点) ═══ */}
        <Mounts point="market.local" />

        {/* ═══ 在线市场(预留) ═══ */}
        <div className="pm-section-title">{t("在线市场")}</div>
        <div className="pm-market-soon">
          <Globe size="1.75rem" aria-hidden />
          <div className="pm-soon-title">{t("远程插件市场 · 建设中")}</div>
          <div>{t("未来可在此浏览、安装社区插件包 —— 新插头直接快递到你的插排")}</div>
          <button type="button" className="pm-soon-btn" disabled>
            {t("即将上线")}
          </button>
        </div>
      </div>
      <div className={`pm-toast${toast ? " show" : ""}`} role="status">
        {toast}
      </div>

      {/* ═══ 二级市场滑出面板:壳只管开合/遮罩,内容全由注册插件贡献 ═══ */}
      {market ? (
        <div className="pm-ext-layer" onClick={() => setMarketFor(null)}>
          <aside
            className="pm-ext-panel"
            role="dialog"
            aria-label={market.title}
            onClick={(e) => e.stopPropagation()}
          >
            <market.component onClose={() => setMarketFor(null)} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
