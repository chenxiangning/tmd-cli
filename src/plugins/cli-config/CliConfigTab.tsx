/**
 * 「CLI 独立配置」tab 本体 —— 引擎子 tab 条 + 配置源切换 + GUI/原始双模式。
 *
 * 引擎清单来自 cliConfigRegistry(未注册的引擎不出现);本组件只管
 * 「选哪个引擎/哪份文件/读它/存它」,字段渲染交给 ConfigForm,文件读写壳在
 * ConfigFile。草稿保护:engine/source/mode 任一切换都会整树重建,脏态时先过
 * DiscardDraftGuard 确认,防未保存草稿被静默清零。
 */

import { useEffect, useMemo, useState } from "react";
import { useCliConfigEntries } from "@kernel/cliConfigRegistry";
import type { CliConfigEntry, CliConfigSource } from "@kernel/cliConfigRegistry";
import { t } from "@kernel/i18n";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { ConfigFile } from "./ConfigFile";
import { useDarkTheme } from "@kernel/theme";

/** 脏态下切换引擎/配置源/模式前的丢弃确认(破坏性操作,红钮形制)。 */
function DiscardDraftGuard({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog
      danger
      title={t("丢弃未保存的修改?")}
      message={t("当前配置有未保存的修改,切换后将丢弃这些修改。")}
      confirmLabel={t("丢弃修改")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

export function CliConfigTab() {
  const entries = useCliConfigEntries();
  const [engineId, setEngineId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingEngineId, setPendingEngineId] = useState<string | null>(null);
  const engine = useMemo<CliConfigEntry | null>(
    () => entries.find((e) => e.id === engineId) ?? entries[0] ?? null,
    [entries, engineId],
  );
  const dark = useDarkTheme();
  /* 脏态时切引擎先确认;确认后 EnginePane 整树重建,草稿随实例复位。 */
  const pickEngine = (id: string) => {
    if (id === engine?.id) return;
    if (dirty) setPendingEngineId(id);
    else setEngineId(id);
  };

  if (entries.length === 0) {
    return <p className="cli-cfg-empty">{t("尚无引擎贡献配置面。")}</p>;
  }

  return (
    <div className="cli-cfg" data-testid="cli-config-tab">
      <div className="cli-cfg-engines" role="tablist" aria-label={t("引擎")}>
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={e.id === engine?.id}
            className={`cli-cfg-engine${e.id === engine?.id ? " is-active" : ""}`}
            onClick={() => pickEngine(e.id)}
          >
            {e.icon?.("0.875rem")}
            {t(e.title)}
          </button>
        ))}
      </div>
      {engine && (
        <EnginePane key={engine.id} engine={engine} dark={dark} dirty={dirty} onDirtyChange={setDirty} />
      )}
      {pendingEngineId && (
        <DiscardDraftGuard
          onConfirm={() => setEngineId(pendingEngineId)}
          onClose={() => setPendingEngineId(null)}
        />
      )}
    </div>
  );
}

/** 待确认的切换动作:切配置源 / 切 GUI↔raw 模式(切引擎在 CliConfigTab 层守)。 */
type PendingSwitch = { kind: "source"; id: string } | { kind: "mode" };

function EnginePane({
  engine,
  dark,
  dirty,
  onDirtyChange,
}: {
  engine: CliConfigEntry;
  dark: boolean;
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [sources, setSources] = useState<CliConfigSource[] | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [mode, setMode] = useState<"gui" | "raw">("gui");
  const [pending, setPending] = useState<PendingSwitch | null>(null);

  useEffect(() => {
    let cancelled = false;
    void engine.sources().then((list) => {
      if (cancelled) return;
      setSources(list);
      setSourceId(list[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  const source = sources?.find((s) => s.id === sourceId) ?? sources?.[0] ?? null;
  if (!sources || !source) return <p className="cli-cfg-empty">{t("读取配置清单…")}</p>;

  /* 脏态先确认后切换:确认即切换,取消保持原状。 */
  const applySwitch = (sw: PendingSwitch) =>
    sw.kind === "source" ? setSourceId(sw.id) : setMode(mode === "gui" ? "raw" : "gui");
  const guardSwitch = (sw: PendingSwitch) => (dirty ? setPending(sw) : applySwitch(sw));

  return (
    <>
      <div className="cli-cfg-bar">
        {sources.length > 1 && (
          <div className="cli-cfg-sources">
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`cli-cfg-src${s.id === source.id ? " is-active" : ""}`}
                onClick={() => guardSwitch({ kind: "source", id: s.id })}
              >
                {t(s.label)}
                {!s.exists && <span className="cli-cfg-src-new">{t("未创建")}</span>}
              </button>
            ))}
          </div>
        )}
        <code className="cli-cfg-path">{source.path}</code>
        {engine.rawEditor && (
          <button
            type="button"
            className="cli-cfg-mode"
            onClick={() => guardSwitch({ kind: "mode" })}
          >
            {mode === "gui" ? t("原始编辑") : t("返回 GUI")}
          </button>
        )}
      </div>
      {source.note && <p className="cli-cfg-note">{t(source.note)}</p>}
      <ConfigFile
        /* 切引擎/切文件/切模式整树重建:脏态与草稿随实例复位(切换前已有丢弃确认)。 */
        key={`${engine.id}:${source.id}:${mode}`}
        engine={engine}
        source={source}
        mode={mode}
        dark={dark}
        onDirtyChange={onDirtyChange}
      />
      {engine.providerPanel && (
        <div className="cli-cfg-provider-panel">
          {engine.providerPanel()}
        </div>
      )}
      {pending && (
        <DiscardDraftGuard onConfirm={() => applySwitch(pending)} onClose={() => setPending(null)} />
      )}
    </>
  );
}
