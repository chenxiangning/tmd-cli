/**
 * 导入视图 —— 扫描本机其他工具的 MCP 配置,按来源分组勾选导入。
 * 冲突语义:目标引擎已有同 id = 默认跳过(不勾),可手动勾选覆盖;
 * 导入 = 深拷贝写回目标引擎(.bak-tmd 备份纪律,经 hubStore)。
 * 手选任意文件(JSON mcpServers / TOML mcp_servers)并进清单(同名保留首个)。
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, FileMagnifyingGlass, FilePlus } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { pickFile } from "@kernel/ipc";
import { StyledSelect } from "@kernel/StyledSelect";
import type { McpEngineState } from "./hubStore";
import { upsertServer } from "./hubStore";
import { summarizeEntry } from "./entryModel";
import { mergeCandidates, scanExternalMcpSources, scanMcpFile, type ImportCandidate } from "./importScan";


export function ImportView({
  engines,
  defaultEngine,
}: {
  engines: McpEngineState[];
  defaultEngine: McpEngineState | null;
}) {
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [scanning, setScanning] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [profileId, setProfileId] = useState(defaultEngine?.profileId ?? engines[0]?.profileId ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const engine = engines.find((e) => e.profileId === profileId) ?? null;

  const scan = () => {
    setScanning(true);
    setResult(null);
    void scanExternalMcpSources()
      .then((found) => {
        setCandidates(found);
        /* 冲突默认跳过:目标引擎已有同 id = 不勾;其余默认全勾。 */
        const existing = new Set(engine?.entries ? Object.keys(engine.entries) : []);
        const next: Record<string, boolean> = {};
        for (const c of found) next[`${c.source}:${c.id}`] = !existing.has(c.id);
        setChecked(next);
      })
      .finally(() => setScanning(false));
  };

  useEffect(() => {
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, ImportCandidate[]>();
    for (const c of candidates) {
      const list = map.get(c.source) ?? [];
      list.push(c);
      map.set(c.source, list);
    }
    return [...map.entries()];
  }, [candidates]);

  const chooseFile = async () => {
    const path = await pickFile(t("选择 MCP 配置文件(JSON 或 TOML)"));
    if (!path) return;
    const label = path.split(/[\\/]/).pop() ?? path;
    const incoming = await scanMcpFile(path, label);
    if (incoming.length === 0) {
      setResult(t("所选文件没有可识别的 MCP server(JSON mcpServers 或 TOML [mcp_servers.*])"));
      return;
    }
    setCandidates((current) => mergeCandidates(current, incoming));
    setChecked((current) => {
      const existing = new Set(engine?.entries ? Object.keys(engine.entries) : []);
      const next = { ...current };
      for (const c of incoming) next[`${c.source}:${c.id}`] = !existing.has(c.id) && !(c.id in next);
      return next;
    });
  };

  const checkedCount = candidates.filter((c) => checked[`${c.source}:${c.id}`]).length;

  const doImport = async () => {
    if (!engine) return;
    setBusy(true);
    setResult(null);
    let done = 0;
    let failed = 0;
    /* eslint-disable react-doctor/async-await-in-loop -- 逐台串行写回是提案选定形态
       (.bak-tmd 备份与失败计数要求顺序执行),并行写多引擎配置文件无收益。 */
    for (const c of candidates) {
      if (!checked[`${c.source}:${c.id}`]) continue;
      try {
        /* 深拷贝:导入不与来源条目共享引用(纯 JSON 数据,structuredClone 语义精准)。 */
        await upsertServer(engine, c.id, structuredClone(c.entry));
        done++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    setResult(t("导入完成:{done} 台写入,{failed} 台失败", { done, failed }));
  };

  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-meta text-(--tmd-fg-faint)">{t("导入到目标引擎")}</span>
          <StyledSelect
            value={profileId}
            ariaLabel={t("导入到目标引擎")}
            options={engines.map((e) => ({ value: e.profileId, label: e.name }))}
            onChange={setProfileId}
          />
        </label>
        <button type="button" className="mcphub-ghost-btn mt-4 flex-none" onClick={scan} disabled={scanning}>
          <ArrowsClockwise size="0.75rem" aria-hidden />
          {scanning ? t("加载中…") : t("重新扫描")}
        </button>
        <button type="button" className="mcphub-ghost-btn mt-4 flex-none" onClick={() => void chooseFile()}>
          <FilePlus size="0.75rem" aria-hidden />
          {t("手选文件")}
        </button>
      </div>

      {groups.length === 0 ? (
        scanning ? (
          <div className="py-10 text-center text-xs leading-relaxed text-(--tmd-fg-faint)">{t("加载中…")}</div>
        ) : (
          /* 空态统一形制:导入源扫描无果 */
          <Empty icon={<FileMagnifyingGlass aria-hidden />}>
            {t("本机没有扫到其他工具的 MCP 配置(claude.json / Claude Desktop / codex / codebuddy 等)")}
          </Empty>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([source, list]) => (
            <div key={source}>
              <div className="mb-1 text-meta font-medium text-(--tmd-fg-muted)">{source}</div>
              <div className="flex flex-col gap-1">
                {list.map((c) => {
                  const key = `${c.source}:${c.id}`;
                  const conflict = engine?.entries ? c.id in engine.entries : false;
                  return (
                    <label key={key} className="mcphub-card flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-(--tmd-accent)"
                        checked={checked[key] ?? false}
                        onChange={(e) => setChecked((s) => ({ ...s, [key]: e.target.checked }))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-(--tmd-fg)">{c.id}</span>
                          {conflict && (
                            <span className="flex-none text-meta text-(--tmd-diff-removed)">
                              {t("目标已有同 id(勾选 = 覆盖)")}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-meta text-(--tmd-fg-faint)">
                          {summarizeEntry(c.entry)}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="min-w-0 text-meta text-(--tmd-fg-faint)">
          {result ?? t("已勾选 {n} 台", { n: checkedCount })}
        </span>
        <button
          type="button"
          className="mcphub-accent-btn flex-none"
          disabled={busy || checkedCount === 0 || !engine}
          onClick={() => void doImport()}
        >
          {busy ? t("写入中…") : t("导入 {n} 台", { n: checkedCount })}
        </button>
      </div>
    </div>
  );
}
