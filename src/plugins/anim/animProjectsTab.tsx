/**
 * anim · tmd-anim 项目列表 tab(kind "anim.projects")。
 *
 * 数据面:~/.tmd-anim/projects/*.json 逐文件最小解析(容错「无效项目」);
 * 2s 轮询仅在本 tab 挂载期运行(非 keepAlive,切走即卸载即停,勿挂常驻轮询)。
 * 未就绪引导:应用探测缺席或项目目录缺失 → AnimInstallGuide(Releases 落点)。
 * 动作:「打开」= 按平台分派(useAnimOpen):mac 探测 tmd-anim 应用后 open-with 项目文件,
 *  windows = explorer /select 目录定位;非 mac 非 win 隐藏;
 * 「AI 会话」= 先弹确认窗(项目 link 卡片 + 引用卡片预览 + 可二次编辑的初始
 * prompt),确认 spawn 默认引擎会话后:初始提示词与引用全部挂 composer 卡片
 * (workbench 任务卡片同款 —— 随下一条消息发出,点提示词卡可再编辑,不灌
 * 输入框、不直写 PTY);取消零副作用(桩也不落盘)。
 */
import { useEffect, useRef, useState } from "react";
import { FilmSlate } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { getPlatformKind } from "@kernel/platform";
import { ensureDir } from "@kernel/fsDirs";
import { resolveDefaultEngine } from "@plugins/workbench/defaultEngine";
import { AiSessionDialog, type AiSessionTarget } from "./AiSessionDialog";
import { AnimInstallGuide } from "./AnimInstallGuide";
import { AnimProjectRow } from "./AnimProjectRow";
import {
  animProjectsDir,
  animSessionRefs,
  isAnimProjectFile,
  parseAnimProject,
} from "./animProjects";
import { useAnimOpen } from "./useAnimOpen";
import { prepareAiSessionTarget, startAnimAiSession, type AnimEngine } from "./startSession";
import { setPendingPrompt } from "@kernel/sessionPending";
import { setPendingRefs } from "./refStore";

const POLL_MS = 2000;

interface AnimRow {
  path: string;
  file: string;
  /** 解析出的项目名;null = 无效项目(展示态,不参与 AI 会话)。 */
  name: string | null;
  /** 解析出的场景数;null = 无效项目。 */
  scenes: number | null;
}
export function AnimProjectsTab() {
  const [rows, setRows] = useState<AnimRow[] | null>(null); /* null = 目录不存在/未读到 */
  const [toast, setToast] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [dialog, setDialog] = useState<AiSessionTarget | null>(null);
  const toastTimer = useRef<number | null>(null);
  const homeRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const showToast = (m: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(m);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };
  /* 「打开」动作面(平台分派/应用探测/reveal,useAnimOpen):windows = 目录定位。 */
  const { action: openAction, appInstalled, open: openInApp } = useAnimOpen(showToast);

  /* 2s 轮询:本 tab 挂载即轮、卸载即停(busy 闸防上一轮未归并发堆叠)。
   * fsCollectFiles(collect_files 原语):目录 .json 收集并按修改时间倒序(最近改动排最前),
   * 目录缺失回空表 —— 「装了 app 但从未跑过」与「没有项目」同走空态,不再误报未装。 */
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      void (async () => {
        try {
          const home = await ipc.configHomeDir();
          homeRef.current = home;
          const dir = animProjectsDir(home);
          const stamps = await ipc.fsCollectFiles(dir, ".json");
          const next: AnimRow[] = await Promise.all(
            stamps.filter((f) => isAnimProjectFile(f.name)).map(async (f) => {
              const parsed = await ipc.fsReadFile(f.path).then(parseAnimProject, () => null);
              return { path: f.path, file: f.name, name: parsed?.name ?? null, scenes: parsed?.scenes ?? null };
            }),
          );
          if (alive) setRows(next);
        } catch {
          if (alive) setRows(null); /* invoke 异常:短暂回未读到态,下一轮重试 */
        } finally {
          loadingRef.current = false;
        }
      })();
    };
    tick();
    const iv = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);

  /* 「AI 会话」点击:prepareAiSessionTarget 只决策不落盘(取消零副作用);
   *  桩路径此处只生成候选文件名,确认时才写盘。失败一律 toast,不静默。 */
  const openAiDialog = async (projectPath: string | null) => {
    const result = await prepareAiSessionTarget({
      home: homeRef.current,
      engine: resolveAnimEngine(),
      projectPath,
      rowName: projectPath !== null ? rows?.find((r) => r.path === projectPath)?.name ?? null : null,
      windows: getPlatformKind() === "windows",
      readFile: (p) => ipc.fsReadFile(p),
      now: Date.now,
      /* 文件名尾随机段:Math.random 足够,非安全场景。 */
      rand: () => Math.random().toString(36).slice(2, 6),
    });
    if (!result.ok) {
      showToast(
        t(
          result.reason === "no-engine"
            ? "未设置默认引擎,请先在工作台概览选择"
            : result.reason === "no-home"
              ? "主目录未就绪,请稍后再试"
              : "项目文件无效,请先在 tmd-anim 中修复",
        ),
      );
      return;
    }
    /* 弹窗直渲 label(此处 t());pending 面另行走 animSessionRefs 源键(chip 端 t())。 */
    setDialog({ ...result.target, refs: result.target.refs.map((r) => ({ ...r, label: t(r.label) })) });
  };

  /* 确认窗「启动会话」:startAnimAiSession 桩先落盘再 spawn,spawn 失败清理
   *  本次落的桩(失败零残留);失败不关窗(toast),保住已编辑 prompt。 */
  const confirmAiSession = async (prompt: string) => {
    const target = dialog;
    if (!target || starting) return;
    setStarting(true);
    try {
      const result = await startAnimAiSession({
        home: homeRef.current,
        engine: resolveAnimEngine(),
        target,
        deps: {
          ensureDir: (dir) => ensureDir(dir),
          writeFile: (p, c) => ipc.fsWriteFile(p, c),
          removePath: (p) => ipc.fsRemovePath(p),
          spawn: (eng, spec) =>
            /* identityTrack:真 CLI 引擎拉起必开,否则磁盘身份永不绑定,
               时间线/审批线/状态读取全盲(契约见 SessionSpawnService.raw)。 */
            host.spawnRawSession(
              eng.profileId,
              {
                command: eng.command,
                args: eng.args,
                cwd: spec.cwd,
                env: eng.env,
                title: spec.title,
              },
              undefined,
              { identityTrack: true },
            ),
        },
      });
      if (!result.ok) {
        showToast(
          t(
            result.reason === "no-engine"
              ? "未设置默认引擎,请先在工作台概览选择"
              : result.reason === "no-home"
                ? "主目录未就绪,请稍后再试"
                : "启动 AI 会话失败",
          ),
        );
        return;
      }
      setPendingPrompt(result.sessionId, prompt.trim());
      /* startAnimAiSession ok 已保证 home 非空。 */
      setPendingRefs(result.sessionId, animSessionRefs(homeRef.current as string, target.path));
      setDialog(null);
    } finally {
      setStarting(false);
    }
  };

  /* 默认引擎 → 管线入参归一(profile 缺失视同未选,由模块上报 no-engine)。 */
  const resolveAnimEngine = (): AnimEngine | null => {
    const def = resolveDefaultEngine();
    const profile = def ? host.getCliProfile(def.profileId) : undefined;
    return def && profile
      ? { profileId: def.profileId, command: profile.command, args: profile.args, env: profile.env ?? {} }
      : null;
  };

  /* 未就绪 = 应用探测缺席(fsCollectFiles 对目录缺失回空表,「装了没跑过」走空态而非未装引导)。 */
  const notReady = appInstalled === false;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3 overflow-auto p-6" data-icon-decor="anim">
      <header>
        <h2 className="text-sm font-semibold text-(--tmd-fg)">{t("动画项目")}</h2>
        <p className="text-xs text-(--tmd-fg-muted)">
          ~/.tmd-anim/projects
          {rows !== null && ` · ${t("共 {n} 个项目", { n: rows.length })}`} · {t("目录变更约 2 秒内自动刷新")}
        </p>
      </header>
      {rows !== null && rows.length > 0 && appInstalled === false && <AnimInstallGuide variant="banner" />}
      {rows === null || rows.length === 0 ? (
        notReady ? (
          <AnimInstallGuide
            variant="card"
            starting={starting}
            onStub={() => void openAiDialog(null)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <div className="flex size-14 items-center justify-center rounded-xl border border-(--tmd-border) bg-(--tmd-bg-subtle)">
              <FilmSlate size={28} className="text-(--tmd-fg-muted)" />
            </div>
            <p className="text-sm text-(--tmd-fg)">{t("还没有动画项目")}</p>
            <p className="max-w-sm text-xs text-(--tmd-fg-muted)">
              {t("在 tmd-anim 中新建的项目会出现在这里;也可以现在建一个项目桩,直接开 AI 会话。")}
            </p>
            <button
              type="button"
              disabled={starting}
              onClick={() => void openAiDialog(null)}
              className="mt-1 rounded border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50"
            >
              {t("AI 会话")}
            </button>
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <AnimProjectRow
              key={row.path}
              path={row.path}
              file={row.file}
              name={row.name}
              scenes={row.scenes}
              starting={starting}
              canOpen={openAction !== null}
              onOpen={() => void openInApp(row.path)}
              onAi={() => void openAiDialog(row.path)}
            />
          ))}
        </ul>
      )}
      {dialog && (
        <AiSessionDialog
          key={dialog.path} /* 换目标重挂,prompt 编辑态随之复位 */
          target={dialog}
          submitting={starting}
          onCancel={() => setDialog(null)}
          onConfirm={(prompt) => void confirmAiSession(prompt)}
        />
      )}
      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded bg-(--tmd-fg) px-3 py-1.5 text-xs text-(--tmd-bg)${toast ? "" : " hidden"}`} role="status">
        {toast}
      </div>
    </div>
  );
}
