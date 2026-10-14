/**
 * anim · tmd-anim 项目列表 tab(kind "anim.projects")。
 *
 * 数据面:~/.tmd-anim/projects/*.json 逐文件最小解析(容错「无效项目」);
 * 2s 轮询仅在本 tab 挂载期运行(非 keepAlive,切走即卸载即停,勿挂常驻轮询)。
 * 动作:「打开」= 探测 tmd-anim 应用后 open-with 项目文件;
 * 「AI 会话」= 先弹确认窗(项目 link 卡片 + 引用卡片预览 + 可二次编辑的初始
 * prompt),确认 spawn 默认引擎会话后:初始提示词与引用全部挂 composer 卡片
 * (workbench 任务卡片同款 —— 随下一条消息发出,点提示词卡可再编辑,不灌
 * 输入框、不直写 PTY);取消零副作用(桩也不落盘)。
 */
import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, FilmSlate, Info } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { ipc, openExternalUrl } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { ensureDir } from "@kernel/fsDirs";
import type { OpenWithTarget } from "@kernel/settingsTypes";
import { resolveDefaultEngine } from "@plugins/workbench/defaultEngine";
import { AiSessionDialog, type AiSessionTarget } from "./AiSessionDialog";
import {
  animProjectsDir,
  animSessionRefs,
  buildAnimSessionPrompt,
  isAnimProjectFile,
  parseAnimProject,
  stubProjectFileName,
  stubProjectJson,
} from "./animProjects";
import { setPendingPrompt, setPendingRefs } from "./refStore";

const POLL_MS = 2000;

/** fsOpenWith 的 tmd-anim 应用目标(mac `open -a tmd-anim`;productName 即应用名)。 */
const ANIM_APP_TARGET: OpenWithTarget = { id: "tmd-anim", label: "tmd-anim", kind: "app", appName: "tmd-anim" };

/** 未安装引导横幅的获取链接(源码仓库,README 含安装方式)。 */
const ANIM_REPO_URL = "https://github.com/chenxiangning/tmd-anim";

interface AnimRow {
  path: string;
  file: string;
  /** 解析出的项目名;null = 无效项目(展示态,不参与 AI 会话)。 */
  name: string | null;
}

export function AnimProjectsTab() {
  const [rows, setRows] = useState<AnimRow[] | null>(null); /* null = 目录不存在/未读到 */
  const [toast, setToast] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /* null = 探测未归;false → 常驻未安装引导横幅(点「打开」时仍会复核探测)。 */
  const [appInstalled, setAppInstalled] = useState<boolean | null>(null);
  const [dialog, setDialog] = useState<AiSessionTarget | null>(null);
  const toastTimer = useRef<number | null>(null);
  const homeRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const showToast = (m: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(m);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  /* 2s 轮询:本 tab 挂载即轮、卸载即停(busy 闸防上一轮未归并发堆叠)。 */
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
          const entries = await ipc.fsListDir(dir);
          const files = entries
            .filter((e) => !e.isDir && isAnimProjectFile(e.name))
            .sort((a, b) => a.name.localeCompare(b.name));
          const next: AnimRow[] = await Promise.all(
            files.map(async (f) => ({
              path: f.path,
              file: f.name,
              name: (await ipc.fsReadFile(f.path).then(parseAnimProject, () => null))?.name ?? null,
            })),
          );
          if (alive) setRows(next);
        } catch {
          if (alive) setRows(null); /* 目录不存在:tmd-anim 未装/未跑过 */
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

  /* 挂载即探测 tmd-anim 应用:缺席 → 常驻引导横幅(探测失败不抛错,保持 null 不打扰)。 */
  useEffect(() => {
    let alive = true;
    ipc
      .fsProbeOpenApp(ANIM_APP_TARGET)
      .then((probe) => {
        if (alive) setAppInstalled(probe.ok);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* 「打开」:先探测应用再 open-with;失败 toast,不抛错。 */
  const openInApp = async (path: string) => {
    try {
      const probe = await ipc.fsProbeOpenApp(ANIM_APP_TARGET);
      if (!probe.ok) {
        showToast(t("未检测到 tmd-anim,请先安装"));
        return;
      }
      await ipc.fsOpenWith(path, ANIM_APP_TARGET);
    } catch {
      showToast(t("打开失败"));
    }
  };

  /* 「AI 会话」点击:校验后开确认窗(link 卡片 + 可编辑 prompt),不 spawn 不落盘。
   *  桩路径此处只生成候选文件名,确认时才写盘(取消零副作用)。 */
  const openAiDialog = async (projectPath: string | null) => {
    const def = resolveDefaultEngine();
    const profile = def ? host.getCliProfile(def.profileId) : undefined;
    if (!def || !profile) {
      showToast(t("未设置默认引擎,请先在工作台概览选择"));
      return;
    }
    const home = homeRef.current;
    if (!home) return;
    let path = projectPath;
    let stub = false;
    if (path !== null) {
      const raw = await ipc.fsReadFile(path).catch(() => null);
      if (raw === null) path = null; /* 列表后文件被删:回落建桩 */
      else if (!parseAnimProject(raw)) {
        showToast(t("项目文件无效,请先在 tmd-anim 中修复"));
        return;
      }
    }
    if (path === null) {
      stub = true;
      /* 文件名尾随机段:Math.random 足够,非安全场景。 */
      path = `${animProjectsDir(home)}/${stubProjectFileName(Date.now(), Math.random().toString(36).slice(2, 6))}`;
    }
    const name = rows?.find((r) => r.path === path)?.name ?? "未命名动画";
    const protocol = `${home}/.tmd-anim/protocol`;
    setDialog({
      name,
      path,
      prompt: buildAnimSessionPrompt(),
      stub,
      refs: [
        { label: t("协议 schema"), path: `${protocol}/schema.md`, kind: "doc" },
        { label: t("协议示例"), path: `${protocol}/bpe-example.json`, kind: "code" },
      ],
    });
  };

  /* 确认窗「启动会话」:桩先落盘,再 spawn + 初始提示词与引用全部挂 composer
   *  卡片(不直写 PTY、不灌输入框;workbench 任务卡片同款 —— 随下一条消息
   *  发出,点提示词卡可再编辑)。失败不关窗(toast),保住已编辑 prompt。 */
  const confirmAiSession = async (prompt: string) => {
    const target = dialog;
    if (!target || starting) return;
    setStarting(true);
    try {
      const def = resolveDefaultEngine();
      const profile = def ? host.getCliProfile(def.profileId) : undefined;
      const home = homeRef.current;
      if (!def || !profile || !home) return;
      if (target.stub) {
        await ensureDir(animProjectsDir(home));
        await ipc.fsWriteFile(target.path, stubProjectJson());
      }
      const meta = await host.spawnRawSession(def.profileId, {
        command: profile.command,
        args: profile.args,
        cwd: animProjectsDir(home),
        env: profile.env,
        title: `tmd-anim:${target.name}`,
      });
      setPendingPrompt(meta.id, prompt.trim());
      setPendingRefs(meta.id, animSessionRefs(home, target.path));
      setDialog(null);
    } catch {
      showToast(t("启动 AI 会话失败"));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3 overflow-auto p-6">
      <header>
        <h2 className="text-sm font-semibold text-(--tmd-fg)">{t("动画项目")}</h2>
        <p className="text-xs text-(--tmd-fg-muted)">~/.tmd-anim/projects · {t("目录变更约 2 秒内自动刷新")}</p>
      </header>
      {appInstalled === false && (
        <div className="flex items-center gap-2.5 rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle) px-3 py-2.5">
          <Info size="1rem" className="flex-none text-(--tmd-accent)" />
          <p className="min-w-0 flex-1 text-xs text-(--tmd-fg-muted)">
            {t("未检测到本机安装 tmd-anim —— 安装后这里会自动列出你的动画项目。")}
          </p>
          <button
            type="button"
            onClick={() => void openExternalUrl(ANIM_REPO_URL)}
            className="flex flex-none items-center gap-1 rounded bg-(--tmd-accent-soft) px-2 py-1 text-xs text-(--tmd-accent) hover:opacity-80"
          >
            <ArrowSquareOut size="0.75rem" />
            {t("获取 tmd-anim")}
          </button>
        </div>
      )}
      {rows === null || rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <FilmSlate size={28} className="text-(--tmd-fg-muted)" />
          <p className="text-sm text-(--tmd-fg)">{t("还没有动画项目")}</p>
          <p className="max-w-sm text-xs text-(--tmd-fg-muted)">
            {t("在 tmd-anim 中新建的项目会出现在这里;也可以现在建一个项目桩,直接开 AI 会话。")}
          </p>
          <button
            type="button"
            disabled={starting}
            onClick={() => void openAiDialog(null)}
            className="mt-1 rounded bg-(--tmd-bg-subtle) px-2 py-1 text-xs text-(--tmd-fg) hover:text-(--tmd-accent) disabled:opacity-50"
          >
            {t("AI 会话")}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <li key={row.path} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-(--tmd-bg-subtle)">
              <span className="min-w-0 shrink-0 truncate text-sm text-(--tmd-fg)">
                {row.name ?? <span className="text-(--tmd-warn)">{t("无效项目")}</span>}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-(--tmd-fg-muted)">{row.file}</span>
              <button
                type="button"
                onClick={() => void openInApp(row.path)}
                className="flex-none rounded bg-(--tmd-bg-subtle) px-2 py-0.5 text-xs text-(--tmd-fg) hover:text-(--tmd-accent)"
              >
                {t("打开")}
              </button>
              <button
                type="button"
                disabled={starting}
                onClick={() => void openAiDialog(row.path)}
                className="flex-none rounded bg-(--tmd-bg-subtle) px-2 py-0.5 text-xs text-(--tmd-fg) hover:text-(--tmd-accent) disabled:opacity-50"
              >
                {t("AI 会话")}
              </button>
            </li>
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
