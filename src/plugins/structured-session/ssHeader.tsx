/**
 * 结构化会话 header —— 引擎切换 / 模型与思考级菜单 + 状态位(极简/中止)。
 * 从 sessionTab 拆出守 300 行铁则;弹层 = 单入口局部菜单(academy 同款外点
 * 收起,无全局浮层管理)。模型动作全走 PiRpcSession 会话级请求:set_model /
 * set_thinking_level 成功后 get_state 回读权威态,onStateRefresh 回写 tab。
 * 引擎切换 = 换 profileId 另开 tab(同 cwd,两引擎 tab 并存,先例 tabs.ts)。
 */
import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { host, useHost } from "@kernel/host";
import { updateSettings } from "@kernel/settings";
import type { PiRpcModel, PiRpcSession, PiRpcState } from "../cli-shared/piRpc";
import { openStructuredSessionTab } from "./tabs";

type MenuKind = "engine" | "model" | null;

/** 引擎菜单(声明 structuredRpc 的 profile 列表;当前项禁用)。 */
function EngineMenu(props: {
  capable: { id: string; name: string; renderIcon?: (size: string) => React.ReactNode }[];
  profileId: string;
  cwd: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const { capable, profileId, cwd, open } = props;
  const cur = capable.find((p) => p.id === profileId);
  return (
    <span className="ss-anchor">
      <button
        type="button"
        className="ss-pill-btn ss-engine-btn"
        aria-expanded={open}
        title={t("切换引擎(另开 tab,当前会话保留)")}
        onClick={props.onToggle}
      >
        {cur?.renderIcon ? <span className="ss-engine-icon">{cur.renderIcon("0.875rem")}</span> : null}
        <span className="ss-engine-name">{cur?.name ?? profileId}</span>
        <CaretDown size="0.7rem" aria-hidden />
      </button>
      {open ? (
        <div className="ss-menu" role="menu" aria-label={t("切换引擎")}>
          {capable.map((p) => (
            <button
              key={p.id}
              type="button"
              className={"ss-menu-item" + (p.id === profileId ? " is-cur" : "")}
              disabled={p.id === profileId}
              onClick={() => { props.onClose(); openStructuredSessionTab(p.id, cwd); }}
            >
              <span className="ss-menu-item-name">{p.name}</span>
              {p.id === profileId ? <span className="ss-menu-item-sub">{t("当前")}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** 模型菜单弹层主体(筛选 + 清单 + 思考级 chips + 错误行)。 */
function ModelMenuBody(props: {
  session: PiRpcSession;
  model: PiRpcModel | null;
  thinkingLevel: string | null;
  models: PiRpcModel[] | null;
  levels: string[];
  loading: boolean;
  menuErr: string | null;
  filter: string;
  setFilter: (v: string) => void;
  onClose: () => void;
  apply: (req: Promise<unknown>) => void;
}) {
  const filterRef = useRef<HTMLInputElement>(null);
  useEffect(() => { filterRef.current?.focus(); }, []);
  const { session, model, thinkingLevel, models, levels, loading, menuErr, filter } = props;
  const filterLower = filter.trim().toLowerCase();
  const filtered = (models ?? []).filter((m) =>
    !filterLower || `${m.name ?? ""} ${m.provider}/${m.id}`.toLowerCase().includes(filterLower));
  return (
    <div className="ss-menu ss-menu-wide" role="menu" aria-label={t("模型与思考级")}>
      <input
        ref={filterRef}
        className="ss-menu-filter"
        value={filter}
        placeholder={t("筛选模型…")}
        onChange={(e) => props.setFilter(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") props.onClose(); }}
      />
      {loading ? <div className="ss-menu-hint">{t("载入模型清单…")}</div> : null}
      {models !== null && models.length === 0 ? <div className="ss-menu-hint">{t("模型清单不可用")}</div> : null}
      <div className="ss-menu-list">
        {filtered.map((m) => (
          <button
            key={`${m.provider}/${m.id}`}
            type="button"
            className={"ss-menu-item" + (model && model.provider === m.provider && model.id === m.id ? " is-cur" : "")}
            onClick={() => props.apply(session.setModel(m.provider, m.id))}
          >
            <span className="ss-menu-item-name">{m.name ?? m.id}</span>
            <span className="ss-menu-item-sub">{m.provider}/{m.id}</span>
          </button>
        ))}
        {models !== null && models.length > 0 && filtered.length === 0 ? (
          <div className="ss-menu-hint">{t("无匹配模型")}</div>
        ) : null}
      </div>
      {levels.length > 0 ? (
        <div className="ss-menu-levels">
          <span className="ss-menu-levels-label">{t("思考级")}</span>
          {levels.map((lv) => (
            <button
              key={lv}
              type="button"
              className={"ss-lv" + (lv === thinkingLevel ? " is-cur" : "")}
              onClick={() => props.apply(session.setThinkingLevel(lv))}
            >
              {lv}
            </button>
          ))}
        </div>
      ) : null}
      {menuErr ? <div className="ss-menu-err" title={menuErr}>{menuErr.slice(0, 120)}</div> : null}
    </div>
  );
}

/** 模型/思考级锚点与弹层编排(懒载清单;open 态由 header 统一持,双菜单互斥)。 */
function ModelMenu(props: {
  session: PiRpcSession;
  model: PiRpcModel | null;
  thinkingLevel: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onStateRefresh: (s: PiRpcState) => void;
}) {
  const { session, model, thinkingLevel, open, onStateRefresh } = props;
  const [models, setModels] = useState<PiRpcModel[] | null>(null);
  const [levels, setLevels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuErr, setMenuErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  /* 开菜单时懒载一次(失败空表 → 菜单内提示;重开菜单即重试) */
  useEffect(() => {
    if (!open || models !== null) return;
    setLoading(true);
    void Promise.all([session.getAvailableModels(), session.getThinkingLevels()])
      .then(([ms, ls]) => { setModels(ms); setLevels(ls); })
      .catch(() => { setModels([]); setLevels([]); })
      .finally(() => setLoading(false));
  }, [open, session, models]);

  /* set 成功 → get_state 回读权威态再收菜单;失败留在菜单内报错 */
  const apply = (req: Promise<unknown>) => {
    setMenuErr(null);
    void req
      .then(() => session.getState())
      .then((s) => { if (s) onStateRefresh(s); props.onClose(); })
      .catch((e: unknown) => setMenuErr(e instanceof Error ? e.message : String(e)));
  };

  const label = model ? model.id + (thinkingLevel ? `:${thinkingLevel}` : "") : t("模型");
  return (
    <span className="ss-anchor ss-anchor-right">
      <button
        type="button"
        className="ss-pill-btn ss-model"
        aria-expanded={open}
        title={model ? `${model.provider}/${model.id}` : undefined}
        onClick={props.onToggle}
      >
        {label}
        <CaretDown size="0.7rem" aria-hidden />
      </button>
      {open ? (
        <ModelMenuBody
          session={session}
          model={model}
          thinkingLevel={thinkingLevel}
          models={models}
          levels={levels}
          loading={loading}
          menuErr={menuErr}
          filter={filter}
          setFilter={setFilter}
          onClose={props.onClose}
          apply={apply}
        />
      ) : null}
    </span>
  );
}

export function SsHeader(props: {
  profileId: string;
  cwd: string;
  model: PiRpcModel | null;
  thinkingLevel: string | null;
  sessionId: string | null;
  busy: boolean;
  queued: number;
  ready: boolean;
  minimal: boolean;
  statusText: string | null;
  session: PiRpcSession | null;
  onStateRefresh: (s: PiRpcState) => void;
  onAbort: () => void;
}) {
  useHost(); /* profile 注册/变化 */
  const { profileId, cwd, model, thinkingLevel, sessionId, busy, queued, ready, minimal, statusText, session } = props;
  const capable = host.getCliProfiles().filter((p) => p.structuredRpc);
  const [menu, setMenu] = useState<MenuKind>(null);
  const rootRef = useRef<HTMLElement>(null);

  /* 点外部收菜单(单入口局部弹层) */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  return (
    <header className="ss-header" ref={rootRef}>
      {capable.length > 1 ? (
        <EngineMenu
          capable={capable}
          profileId={profileId}
          cwd={cwd}
          open={menu === "engine"}
          onToggle={() => setMenu(menu === "engine" ? null : "engine")}
          onClose={() => setMenu(null)}
        />
      ) : (
        <span className="ss-engine-static">
          {host.getCliProfile(profileId)?.renderIcon
            ? <span className="ss-engine-icon">{host.getCliProfile(profileId)!.renderIcon!("0.875rem")}</span>
            : null}
          <span className="ss-engine-name">{host.getCliProfile(profileId)?.name ?? profileId}</span>
        </span>
      )}
      <span className="ss-cwd">{cwd}</span>
      {model && ready && session ? (
        <ModelMenu
          session={session}
          model={model}
          thinkingLevel={thinkingLevel}
          open={menu === "model"}
          onToggle={() => setMenu(menu === "model" ? null : "model")}
          onClose={() => setMenu(null)}
          onStateRefresh={props.onStateRefresh}
        />
      ) : model ? (
        <span className="ss-model">{model.id}</span>
      ) : null}
      {sessionId ? <span className="ss-sid">{sessionId.slice(0, 8)}</span> : null}
      <button
        type="button"
        className={"ss-minimal" + (minimal ? " is-on" : "")}
        title={t("极简展示:每轮工作过程折叠为一行,只保留最终答复")}
        aria-pressed={minimal}
        onClick={() => updateSettings({ sessionViewerMinimal: !minimal })}
      >
        {t("极简")}
      </button>
      <span className={`ss-dot${busy ? " is-busy" : ""}`} title={busy ? t("生成中") : t("空闲")} />
      {queued > 0 ? <span className="ss-queued" title={t("当前轮结束后自动发送")}>{t("排队 {n}", { n: queued })}</span> : null}
      {statusText ? <span className="ss-status" title={statusText}>{statusText.slice(0, 80)}</span> : null}
      {busy ? (
        <button type="button" className="ss-abort" onClick={props.onAbort}>
          {t("中止")}
        </button>
      ) : null}
    </header>
  );
}
