/**
 * 「CLI 独立配置」tab 本体 —— 引擎子 tab 条 + 配置源切换 + GUI/原始双模式。
 *
 * 引擎清单来自 cliConfigRegistry(未注册的引擎不出现);本组件只管
 * 「选哪个引擎/哪份文件/读它/存它」,字段渲染交给 ConfigForm。
 * 读文件三态:ok 进编辑;missing(不存在)按空文件可首次创建;
 * error(存在但不可读)阻断编辑,防覆写丢失。
 */

import { useEffect, useMemo, useState } from "react";
import { FileCodeEditor } from "@kernel/cmEditor/FileCodeEditor";
import { ipc } from "@kernel/ipc";
import { useCliConfigEntries } from "@kernel/cliConfigRegistry";
import type { CliConfigEntry, CliConfigSource } from "@kernel/cliConfigRegistry";
import { t } from "@kernel/i18n";
import { readConfig, writeConfigFile } from "./io";
import { ConfigForm } from "./ConfigForm";

/** 编辑器明暗跟随 <html data-theme>(files/ssh 编辑器同款本地钩子,先例三处)。 */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document === "undefined"
      ? false
      : document.documentElement.getAttribute("data-theme") === "dark",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function CliConfigTab() {
  const entries = useCliConfigEntries();
  const [engineId, setEngineId] = useState<string | null>(null);
  const engine = useMemo<CliConfigEntry | null>(
    () => entries.find((e) => e.id === engineId) ?? entries[0] ?? null,
    [entries, engineId],
  );
  const dark = useDarkTheme();

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
            onClick={() => setEngineId(e.id)}
          >
            {e.icon?.("0.875rem")}
            {t(e.title)}
          </button>
        ))}
      </div>
      {engine && <EnginePane key={engine.id} engine={engine} dark={dark} />}
    </div>
  );
}

function EnginePane({ engine, dark }: { engine: CliConfigEntry; dark: boolean }) {
  const [sources, setSources] = useState<CliConfigSource[] | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [mode, setMode] = useState<"gui" | "raw">("gui");

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
                onClick={() => setSourceId(s.id)}
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
            onClick={() => setMode(mode === "gui" ? "raw" : "gui")}
          >
            {mode === "gui" ? t("原始编辑") : t("返回 GUI")}
          </button>
        )}
      </div>
      {source.note && <p className="cli-cfg-note">{t(source.note)}</p>}
      <ConfigFile
        /* 切引擎/切文件/切模式整树重建:脏态与草稿随实例复位。 */
        key={`${engine.id}:${source.id}:${mode}`}
        engine={engine}
        source={source}
        mode={mode}
        dark={dark}
      />
    </>
  );
}

function BlockingError({ title, message, path }: { title: string; message: string; path: string }) {
  return (
    <div className="cli-cfg-error" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <button
        type="button"
        className="cli-cfg-link"
        onClick={() => void ipc.fsRevealInFileManager(path)}
      >
        {t("在文件管理器中显示")}
      </button>
    </div>
  );
}

function ConfigFile({
  engine,
  source,
  mode,
  dark,
}: {
  engine: CliConfigEntry;
  source: CliConfigSource;
  mode: "gui" | "raw";
  dark: boolean;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRaw(null);
    setDraft(null);
    setLoadError(null);
    setReadError(null);
    void readConfig(source.path).then((r) => {
      if (cancelled) return;
      if (r.kind === "error") {
        setReadError(r.message);
        return;
      }
      const content = r.kind === "ok" ? r.text : "";
      setRaw(content);
      setDraft(content);
      /* 空文件同样过一遍 load 校验:ConfigForm 的 useState 初始化会再调 load,
         不先验证会让插件抛错直接崩掉整个 section。 */
      try {
        engine.load(content);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [engine, source.path]);

  if (raw === null) return <p className="cli-cfg-empty">{t("读取配置…")}</p>;

  const persist = async (next: string) => {
    setSaving(true);
    try {
      await writeConfigFile(source.path, next);
      setRaw(next);
      setDraft(next);
      setWriteError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setWriteError(msg);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  if (readError) {
    return (
      <BlockingError title={t("无法读取配置文件")} message={readError} path={source.path} />
    );
  }

  if (loadError) {
    return (
      <BlockingError title={t("无法解析配置文件")} message={loadError} path={source.path} />
    );
  }

  if (mode === "raw" && engine.rawEditor) {
    const dirty = draft !== raw;
    return (
      <div className="cli-cfg-raw">
        <FileCodeEditor
          path={source.path}
          value={draft ?? raw}
          dark={dark}
          onChange={setDraft}
          onSave={() => void persist(draft ?? raw).catch(() => undefined)}
        />
        {writeError && (
          <div className="cli-cfg-error" role="alert">
            <p>{writeError}</p>
          </div>
        )}
        {dirty && (
          <div className="cli-cfg-savebar" data-testid="cli-cfg-savebar">
            <span className="cli-cfg-dirty">{t("● 未保存的更改")}</span>
            <button type="button" className="cli-cfg-btn" onClick={() => setDraft(raw)}>
              {t("放弃")}
            </button>
            <button
              type="button"
              className="cli-cfg-btn is-primary"
              disabled={saving}
              onClick={() => void persist(draft ?? raw).catch(() => undefined)}
            >
              {t("保存到磁盘")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return <ConfigForm engine={engine} raw={raw} onSaved={persist} />;
}
