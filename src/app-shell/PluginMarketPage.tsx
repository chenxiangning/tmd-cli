/**
 * 插件市场页(插排) —— 客户端 = 插排本体,插件 = 插头,点击插拔。
 *
 * 语义:插拔 = 启停插件,写 settings.disabledPlugins 持久化,重启后生效
 * (activateAll 组装时过滤);运行中不热卸载(避免 PTY/事件订阅泄漏)。
 * 核心插件(meta.category === "core")焊死不可拔。
 *
 * 布局:按 meta.category 分排 —— 每类一条大插排(CLI 引擎 / 界面功能 / 核心系统),
 * 下方清单同样按类分节;插拔动画与单排一致(见 styles/plugin-market.css)。
 *
 * 数据源:host.listPluginStates()(启动态) × settings.disabledPlugins(期望态),
 * 两者不一致 = dirty,展示"重启后生效"徽章。
 */

import { useMemo, useRef, useState } from "react";
import { Globe, Lock, RotateCw, X } from "lucide-react";
import { host } from "@kernel/host";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { appRestart } from "@kernel/ipc";
import type { Plugin, PluginCategory } from "@kernel/plugin";

/** 分类展示顺序与中文名(插排分排 + 清单分节共用)。 */
const CATEGORY_LABEL: Record<PluginCategory, string> = {
  engine: "CLI 引擎",
  feature: "界面功能",
  core: "核心系统",
};
const CATEGORY_ORDER: readonly PluginCategory[] = ["engine", "feature", "core"];

interface Row {
  plugin: Plugin;
  /** 启动态(本次激活与否)。 */
  bootOn: boolean;
  /** 期望态(disabledPlugins 反相)。 */
  on: boolean;
  dirty: boolean;
}

/** 单个插座单元:插头(可点) + 孔位 + 标签。 */
function Outlet({
  id,
  name,
  abbr,
  core,
  on,
  dirty,
  onToggle,
}: {
  id: string;
  name: string;
  abbr: string;
  core: boolean;
  /** 期望态:true = 插入。 */
  on: boolean;
  /** 期望态 ≠ 启动态 → 重启后生效。 */
  dirty: boolean;
  onToggle: (id: string) => void;
}) {
  const cls = `pm-outlet${on ? "" : " is-out"}${core ? " is-core" : ""}${dirty ? " is-dirty" : ""}`;
  const tip = core
    ? "核心插件 · 已焊死,不可拔出"
    : on
      ? `点击拔出 ${id}`
      : `点击插入 ${id}`;
  return (
    <div className={cls}>
      <div className="pm-plug" title={tip} onClick={() => onToggle(id)}>
        <svg className="pm-cord" viewBox="0 0 60 46" aria-hidden>
          <path d={`M30 46 C 30 20, ${on ? 18 : 44} 26, 30 -6`} />
        </svg>
        <div className="pm-plug-body">
          {core ? (
            <span className="pm-plug-weld" title="核心插件">
              <Lock size={10} aria-hidden />
            </span>
          ) : null}
          <span className="pm-plug-led" aria-hidden />
          <span className="pm-plug-icon">{abbr}</span>
          <span className="pm-plug-name">{name}</span>
        </div>
        <div className="pm-prongs" aria-hidden>
          <span className="pm-prong" />
          <span className="pm-prong" />
        </div>
      </div>
      <div className="pm-socket" aria-hidden>
        <span className="pm-socket-hole" />
        <span className="pm-socket-hole" />
      </div>
      <div className="pm-outlet-label">
        {id}
        {dirty ? " · 待重启" : ""}
      </div>
    </div>
  );
}

/** 一条分类大插排:品牌区(分类名 + 位数 + 电源 LED) + 该类全部插座。 */
function CategoryStrip({
  category,
  rows,
  onToggle,
}: {
  category: PluginCategory;
  rows: Row[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="pm-strip-scene">
      <div className="pm-strip">
        <div className="pm-strip-brand">
          <div className="pm-brand-name">{CATEGORY_LABEL[category]}</div>
          <div className="pm-brand-role">分类插排 · {rows.length} 位</div>
          <div className="pm-master-row">
            <span className="pm-master-led" aria-hidden />
            <span className="pm-master-label">电源常开</span>
          </div>
        </div>
        {rows.map(({ plugin, on, dirty }) => (
          <Outlet
            key={plugin.id}
            id={plugin.id}
            name={plugin.meta.name}
            abbr={plugin.meta.abbr}
            core={plugin.meta.category === "core"}
            on={on}
            dirty={dirty}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

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
    return { plugin, bootOn: enabled, on, dirty: on !== enabled };
  });
  /* 按分类分排:固定顺序,空类不渲染(防御:现网三类均非空)。 */
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((r) => r.plugin.meta.category === category),
  })).filter((g) => g.rows.length > 0);
  const dirtyCount = rows.filter((r) => r.dirty).length;

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
        ? `已拔出 ${id} —— 重启后从插排断电`
        : `已插入 ${id} —— 重启后生效`,
    );
  }

  return (
    <div className="pm-page">
      <div className="pm-inner">
        <div className="pm-head">
          <span className="pm-title">插件市场</span>
          <span className="pm-sub">
            客户端是插排,插件是插头 —— 插上即用,拔掉即停
          </span>
          <div className="pm-head-actions">
            <button
              type="button"
              className={`pm-restart${dirtyCount > 0 ? " dirty" : ""}`}
              title={dirtyCount > 0 ? `${dirtyCount} 个插拔变更待重启生效` : "重启应用"}
              onClick={restart}
            >
              <RotateCw size={12} aria-hidden />
              重启应用{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
            </button>
            <button
              type="button"
              className="pm-close"
              aria-label="关闭插件市场"
              title="关闭插件市场"
              onClick={onClose}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        </div>

        {/* ═══ 分类大插排 ═══ */}
        {groups.map((g) => (
          <CategoryStrip key={g.category} category={g.category} rows={g.rows} onToggle={toggle} />
        ))}
        <div className="pm-strip-caption">
          <span>
            <span className="pm-legend-dot" style={{ background: "var(--tmd-accent)" }} />
            已插入(运行中)
          </span>
          <span>
            <span className="pm-legend-dot" style={{ background: "var(--tmd-fg-faint)" }} />
            已拔出(重启后生效)
          </span>
          <span>焊死的核心插件不可拔</span>
          <span>点击插头即可插拔</span>
        </div>

        {/* ═══ 插件清单(分类列表) ═══ */}
        {groups.map((g) => (
          <section key={g.category}>
            <div className="pm-section-title">
              {CATEGORY_LABEL[g.category]}
              <span className="pm-count">
                {g.rows.filter((r) => r.on).length}/{g.rows.length} 已插入
              </span>
            </div>
            <div className="pm-card-grid">
              {g.rows.map(({ plugin, on, dirty }) => {
                const core = plugin.meta.category === "core";
                return (
                  <div key={plugin.id} className={`pm-card${on ? "" : " is-out"}`}>
                    <div className="pm-card-icon">{plugin.meta.abbr}</div>
                    <div className="pm-card-main">
                      <div className="pm-card-name">
                        {plugin.meta.name}
                        <span className="pm-card-id">{plugin.id}</span>
                      </div>
                      <div className="pm-card-desc">{plugin.meta.desc}</div>
                      <div className="pm-card-foot">
                        {core ? <span className="pm-badge core">核心 · 焊死</span> : null}
                        {dirty ? <span className="pm-badge dirty">重启后生效</span> : null}
                        <button
                          type="button"
                          className={`pm-toggle-btn${on ? " on" : ""}`}
                          disabled={core}
                          onClick={() => toggle(plugin.id)}
                        >
                          {core ? "常插" : on ? "拔出" : "插入"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {/* ═══ 在线市场(预留) ═══ */}
        <div className="pm-section-title">在线市场</div>
        <div className="pm-market-soon">
          <Globe size={28} aria-hidden />
          <div className="pm-soon-title">远程插件市场 · 建设中</div>
          <div>未来可在此浏览、安装社区插件包 —— 新插头直接快递到你的插排</div>
          <button type="button" className="pm-soon-btn" disabled>
            即将上线
          </button>
        </div>
      </div>

      <div className={`pm-toast${toast ? " show" : ""}`} role="status">
        {toast}
      </div>
    </div>
  );
}
