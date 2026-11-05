/**
 * 结构化会话 header —— 引擎静态标识 / 模型与思考级菜单 + 状态位(极简/中止)。
 * 从 sessionTab 拆出守 300 行铁则;弹层 = 单入口局部菜单(academy 同款外点
 * 收起,无全局浮层管理)。模型动作全走 PiRpcSession 会话级请求:set_model /
 * set_thinking_level 成功后 get_state 回读权威态,onStateRefresh 回写 tab。
 * 引擎切换下拉已撤除(2026-11-05 用户裁决):换引擎 = 新建菜单另开 tab,
 * 路径/上下文占用迁底部工具条(ssToolbar)。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { errTextDisplay } from "@kernel/errText";
import { CaretDown } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { host, useHost } from "@kernel/host";
import type { PiRpcModel, PiRpcSession, PiRpcState } from "../cli-shared/piRpc";
import { StatusCluster } from "./ssStatus";

type MenuKind = "model" | null;

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
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
          /* Enter 选中首个匹配(空筛 = 当前清单第一项),tab 补全同效。 */
          if ((e.key === "Enter" || e.key === "Tab") && filtered[0]) {
            e.preventDefault();
            props.apply(session.setModel(filtered[0].provider, filtered[0].id));
          }
        }}
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

  /* 开菜单懒载一次;失败/空表留在菜单内提示,关菜单复位 —— 重开即重试
   * (2026-10-05 二轮复审:守卫放行空表 + setModels([]) 新引用 = 自触发无限重试)。 */
  useEffect(() => {
    if (!open) {
      if (models !== null && models.length === 0) setModels(null);
      return;
    }
    if (models !== null) return;
    let alive = true;
    setLoading(true);
    void Promise.all([session.getAvailableModels(), session.getThinkingLevels()])
      .then(([ms, ls]) => { if (alive) { setModels(ms); setLevels(ls); } })
      .catch(() => { if (alive) { setModels([]); setLevels([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, session, models]);

  /* set 成功 → get_state 回读权威态再收菜单;失败留在菜单内报错 */
  const apply = (req: Promise<unknown>) => {
    setMenuErr(null);
    void req
      .then(() => session.getState())
      .then((s) => { if (s) onStateRefresh(s); props.onClose(); })
      .catch((e: unknown) => setMenuErr(errTextDisplay(e)));
  };

  const label = model ? model.id + (thinkingLevel ? `:${thinkingLevel}` : "") : t("模型");
  return (
    <span className="ss-anchor">
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
  model: PiRpcModel | null;
  thinkingLevel: string | null;
  sessionId: string | null;
  busy: boolean;
  queued: number;
  ready: boolean;
  minimal: boolean;
  statusText: string | null;
  session: PiRpcSession | null;
  actions: ReactNode;
  onStateRefresh: (s: PiRpcState) => void;
  onAbort: () => void;
}) {
  useHost(); /* profile 注册/变化 */
  const { profileId, model, thinkingLevel, sessionId, busy, queued, ready, minimal, statusText, session } = props;
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
      {/* 引擎静态标识(下拉切换撤除 2026-11-05;换引擎走新建菜单另开 tab) */}
      <span className="ss-engine-static">
        {host.getCliProfile(profileId)?.renderIcon
          ? <span className="ss-engine-icon">{host.getCliProfile(profileId)!.renderIcon!("0.875rem")}</span>
          : null}
        <span className="ss-engine-name">{host.getCliProfile(profileId)?.name ?? profileId}</span>
      </span>
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
      {props.actions}
      <StatusCluster
        sessionId={sessionId}
        minimal={minimal}
        busy={busy}
        queued={queued}
        statusText={statusText}
        onAbort={props.onAbort}
      />
    </header>
  );
}
