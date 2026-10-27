/**
 * 跨引擎原生记忆文件面板 —— 声明式发现 + 一键进编辑器 + 未生成一键写空模板,零 AI。
 *
 * 三组渲染:项目级(当前工作区 cwd,无工作区整组隐藏)/ 用户级(Home)/
 * 未声明(零声明 profile 灰行,默认折叠)。行三态:在(文件名可点进编辑器)/
 * 未生成(「生成模板」钮 = 写空壳文件,完整内容留给终端 /init)/ 未声明(不猜路径)。
 * 数据面在 memoryFilesData.ts,行组件在 MemoryFilesRows.tsx(拆分守 300 行铁则)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Pulse } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { userHome } from "../paths";
import { LintView } from "../lint/LintView";
import {
  expandMemorySlots,
  generateMemoryTemplate,
  probeMemoryFiles,
  summarizeMemoryFiles,
  undeclaredEngines,
  type MemoryProbeMap,
  type MemorySlot,
} from "./memoryFilesData";
import { DeclaredGroups, UndeclaredGroup } from "./MemoryFilesRows";

/** 行内动作钮统一形(重探钮;行生成钮在 MemoryFilesRows 内持同款)。 */
const ACTION_CLS =
  "flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50 disabled:hover:border-(--tmd-border) disabled:hover:text-(--tmd-fg-muted)";

export function MemoryFilesPanel() {
  useHost(); /* profile 注册面变化(插件启停)重渲 */
  const profiles = host.getCliProfiles();
  const { list, activeId } = useWorkspaces();
  const cwd = list.find((w) => w.id === activeId)?.root ?? null;
  const [home, setHome] = useState("");
  const [probe, setProbe] = useState<MemoryProbeMap>({});
  const [probing, setProbing] = useState(false);
  const [probedOnce, setProbedOnce] = useState(false);
  const [undeclaredOpen, setUndeclaredOpen] = useState(false);
  const [genBusy, setGenBusy] = useState<string | null>(null);
  const [genFailed, setGenFailed] = useState<MemoryProbeMap>({});
  const [lintOpen, setLintOpen] = useState(false);

  useEffect(() => {
    userHome()
      .then(setHome)
      .catch(() => setHome(""));
  }, []);

  const { project, user } = useMemo(
    () => (home === "" ? { project: [], user: [] } : expandMemorySlots(profiles, cwd, home)),
    [profiles, cwd, home],
  );
  const undeclared = useMemo(() => undeclaredEngines(profiles), [profiles]);
  const summary = useMemo(
    () => summarizeMemoryFiles(project, user, probe, undeclared.length),
    [project, user, probe, undeclared.length],
  );

  const runProbe = useCallback(async () => {
    const paths = [...project, ...user].map((s) => s.absPath);
    setProbing(true);
    setGenFailed({});
    try {
      setProbe(await probeMemoryFiles(paths));
      setProbedOnce(true);
    } finally {
      setProbing(false);
    }
  }, [project, user]);

  /* 生成空模板:写盘成功即原位翻转状态(免一轮重探 IPC);失败仅行内标记,不动探针 */
  const generate = useCallback(async (slot: MemorySlot) => {
    setGenBusy(slot.absPath);
    try {
      await generateMemoryTemplate(slot);
      setGenFailed((prev) => ({ ...prev, [slot.absPath]: false }));
      setProbe((prev) => ({ ...prev, [slot.absPath]: true }));
    } catch {
      setGenFailed((prev) => ({ ...prev, [slot.absPath]: true }));
    } finally {
      setGenBusy(null);
    }
  }, []);

  const pathsKey = [...project, ...user].map((s) => s.absPath).join("\n");
  useEffect(() => {
    if (home === "") return;
    void runProbe();
    /* 槽集(路径串)或 home 变化即重探;runProbe 随槽集重建,豁免其自身依赖 */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 路径串引用随槽集变化即重探,豁免 runProbe 恒新引用
  }, [pathsKey, home]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-icon-decor="memory">
      {lintOpen ? (
        <LintView cwd={cwd} workspaceId={activeId ?? null} onBack={() => setLintOpen(false)} />
      ) : (
        <>
          {/* 头部:摘要 + 重新探测 + 体检 */}
          <div className="flex flex-none items-center gap-2 px-1.5 py-1.5">
            <span className="min-w-0 truncate text-xs text-(--tmd-fg-muted)">
              {probedOnce || probing
                ? t("{n} 在 · {m} 缺 · {k} 未声明", { n: summary.ok, m: summary.missing, k: summary.undeclared })
                : t("探测中…")}
            </span>
            <button
              type="button"
              onClick={() => setLintOpen(true)}
              disabled={!cwd}
              className={`${ACTION_CLS} ml-auto inline-flex items-center gap-1`}
              title={t("读近 30 天对话日志,AI 判定各文件里的规则是否真的生效")}
            >
              <Pulse aria-hidden />
              {t("体检")}
            </button>
            <button
              type="button"
              onClick={() => void runProbe()}
              disabled={probing || (project.length === 0 && user.length === 0)}
              className={`${ACTION_CLS} inline-flex items-center gap-1`}
              title={t("按 profile 声明批量探测")}
            >
              {probing ? <Spinner /> : <ArrowClockwise aria-hidden />}
              {t("重新探测")}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-0.5">
            <DeclaredGroups
              cwd={cwd}
              project={project}
              user={user}
              probe={probe}
              pending={!probedOnce}
              genBusy={genBusy}
              genFailed={genFailed}
              onGenerate={(slot) => void generate(slot)}
            />
            {undeclared.length > 0 && (
              <UndeclaredGroup
                engines={undeclared}
                open={undeclaredOpen}
                onToggle={() => setUndeclaredOpen(!undeclaredOpen)}
              />
            )}
            {home !== "" && project.length === 0 && user.length === 0 && (
              <div className="p-3 text-center text-xs text-(--tmd-fg-faint)">{t("尚无引擎声明记忆文件")}</div>
            )}
          </div>

          {/* footbar:职责声明(列表视图只发现/跳转/写空模板;体检视图的 AI 声明见 LintView) */}
          <div className="flex-none border-t border-(--tmd-border) px-1.5 py-1.5 text-meta leading-relaxed text-(--tmd-fg-muted)">
            {t("编辑=打开文件编辑器,复用未保存闸与查找;生成=写空模板文件;检索零 AI")}
          </div>
        </>
      )}
    </div>
  );
}
