/**
 * 侧栏工作区文件浏览器(复刻参考稿)—— 工作区行「查看文件」打开,整体替换
 * 左栏任务列表;「返回任务」关闭(kernel workspaceFileBrowser 契约)。
 *
 * 复用面(右栏同源,零新逻辑):
 * - 目录浏览:useDirTree(右栏 FileTree 同一实现)
 * - git 状态:useRepoStatusState + gitDecorateModel 纯函数(颜色口径与右栏一致)
 * - 文件视觉/开 tab:resolveFileVisual / openFileInTab;行样式复用 .file-tree-* 类
 * 侧栏特有交互:搜索(文件名,fs_walk 同源扫描)/ 漏斗(仅看变更,变更剪枝树)/
 *  忽略降显(git_ignored_prefixes)/ ⋯ 菜单(访达+复制路径)。视觉件与列表态拆至
 *  WsfbChromeTop / WsfbRow / WsfbLists / WsfbBodies(文件规模铁则)。
 * git 装饰有意不受右栏「Git 变更」开关约束:浏览器自带字母/着色是浏览语义
 *  的一部分(搜索过滤后仍需要),开关只管辖右栏文件树的装饰渲染。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, DotsThree, Funnel } from "@phosphor-icons/react";
import { ipc, type DirEntry } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { useWorkspaces, workspaceDisplayName } from "@kernel/workspace";
import { findRemoteFileSource } from "@kernel/fileSources";
import { openFileInTab } from "@kernel/fileTabs";
import type { WorkspaceFileBrowserProps } from "@kernel/workspaceFileBrowser";
import { useDirTree } from "./useDirTree";
import { useTreeOperations } from "./useTreeOperations";
import { FileTreeOverlays } from "./FileTreeOverlays";
import { useRepoStatusState } from "./gitDecorate";
import { buildLetterMap } from "./gitDecorateModel";
import type { WsfbRowMenu } from "./WsfbLists";
import {
  changedTreeOf,
  decorationColors,
  filterWalkHits,
} from "./workspaceBrowserModel";
import { WsfbChromeTop } from "./WsfbChromeTop";
import { AllFilesBody, ChangedBody, SearchBody } from "./WsfbBodies";
import { WsfbMoreMenu } from "./WsfbRow";

const SEARCH_WALK_CAP = 4000;

function WsfbBrowser({ workspaceId, root }: WorkspaceFileBrowserProps) {
  const { list } = useWorkspaces();
  const ws = list.find((w) => w.id === workspaceId) ?? null;
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [changedOpen, setChangedOpen] = useState<Record<string, true>>({});
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [hits, setHits] = useState<string[] | null>(null);
  const [hitsTruncated, setHitsTruncated] = useState(false);
  const [walkError, setWalkError] = useState(false);
  const [tick, setTick] = useState(0);
  /* —— 数据面(右栏同源)—— */
  const { entries, expanded, selectedPath, setSelectedPath, loading, reloadAll, revealDir, toggle } =
    useDirTree(root);
  /* 行右键/命名弹窗/轻提示:与右栏 FileTree 同一 useTreeOperations(零新逻辑)。 */
  const ops = useTreeOperations({ root, revealDir, setSelected: setSelectedPath });
  const rowMenu = useCallback<WsfbRowMenu>(
    (entry) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      ops.openMenu(e.clientX, e.clientY, entry as DirEntry);
    },
    [ops],
  );
  const { entries: statusEntries, single } = useRepoStatusState(root, true);
  const base = root.replace(/\/+$/, "");

  /* 忽略前缀:挂载/手动刷新拉取(低频);非仓/失败 = 空集(绝对路径口径)。
   * ponytail: 嵌套仓各自的 ignore 未并入,需要时逐仓再取。 */
  useEffect(() => {
    let alive = true;
    ipc.gitIgnoredPrefixes(root).then(
      (out) => {
        if (alive) setIgnored(out.map((p) => `${base}/${p}`));
      },
      () => {
        if (alive) setIgnored([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [root, base, tick]);

  /* 装饰与剪枝(纯派生;颜色/字母与右栏同口径)。 */
  const colors = useMemo(
    () => decorationColors(root, statusEntries, single),
    [statusEntries, single, root],
  );
  const letters = useMemo(() => buildLetterMap(statusEntries ?? []), [statusEntries]);
  const changedTree = useMemo(() => changedTreeOf(base, statusEntries), [statusEntries, base]);
  /* 搜索:200ms 去抖走带截断标志的 fs_walk_index;失败显式「搜索失败」。 */
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits(null); setHitsTruncated(false); setWalkError(false); return; }
    let alive = true;
    const timer = window.setTimeout(() => {
      ipc.fsWalkIndex(root, SEARCH_WALK_CAP).then(
        (res) => {
          if (!alive) return;
          setWalkError(false);
          setHits(filterWalkHits(root, res.files, q));
          setHitsTruncated(res.truncated); /* cap 满额与 3s 预算两臂统一由标志承载 */
        },
        () => {
          if (!alive) return;
          /* 目录不可读/被删:显式失败,不伪装成「没有匹配的文件」 */
          setHits([]);
          setHitsTruncated(false);
          setWalkError(true);
        },
      );
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, root, tick]);

  const body = useMemo(() => {
    if (query.trim() !== "") {
      return (
        <SearchBody
          hits={hits}
          truncated={hitsTruncated}
          error={walkError}
          selectedPath={selectedPath}
          colors={colors}
          letters={letters}
          ignored={ignored}
          rowMenu={rowMenu}
          onPick={(p) => {
            setSelectedPath(p);
            openFileInTab(p);
          }}
        />
      );
    }
    if (changedOnly) {
      return (
        <ChangedBody
          rootKids={changedTree.get(base) ?? []}
          changedTree={changedTree}
          changedOpen={changedOpen}
          selectedPath={selectedPath}
          colors={colors}
          letters={letters}
          rowMenu={rowMenu}
          onSelect={setSelectedPath}
          onToggleDir={(p) =>
            setChangedOpen((prev) => {
              const next = { ...prev };
              if (next[p]) delete next[p];
              else next[p] = true;
              return next;
            })
          }
        />
      );
    }
    return (
      <AllFilesBody
        entries={entries}
        expanded={expanded}
        selectedPath={selectedPath}
        colors={colors}
        letters={letters}
        ignored={ignored}
        rowMenu={rowMenu}
        loading={loading}
        onToggle={toggle}
      />
    );
  }, [
    query,
    hits,
    hitsTruncated,
    walkError,
    changedOnly,
    base,
    changedTree,
    changedOpen,
    entries,
    expanded,
    selectedPath,
    colors,
    letters,
    ignored,
    loading,
    setSelectedPath,
    toggle,
    rowMenu,
  ]);

  const headName = (ws ? workspaceDisplayName(ws) : "") || base.split("/").pop() || base;

  return (
    <div className="wsfb">
      <WsfbChromeTop
        query={query}
        onQuery={setQuery}
        changedOnly={changedOnly}
        onExitChanged={() => setChangedOnly(false)}
      />
      <div className="wsfb-head">
        <span className="wsfb-head-name" title={root}>
          {headName}
        </span>
        <span className="wsfb-head-actions">
          <button
            type="button"
            className="wsfb-head-btn"
            title={t("更多操作")}
            aria-label={t("更多操作")}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuPos({
                x: Math.min(Math.max(8, r.left), window.innerWidth - 232),
                y: Math.min(Math.max(8, r.bottom + 4), window.innerHeight - 110),
              });
            }}
          >
            <DotsThree size="1rem" weight="bold" aria-hidden />
          </button>
          <button
            type="button"
            className={`wsfb-head-btn${changedOnly ? " is-on" : ""}`}
            title={changedOnly ? t("显示全部文件") : t("仅显示有变更的文件")}
            aria-pressed={changedOnly}
            onClick={() => {
              setChangedOnly((v) => !v);
              setQuery("");
            }}
          >
            <Funnel size="0.875rem" aria-hidden />
          </button>
          <button
            type="button"
            className="wsfb-head-btn"
            title={t("刷新")}
            aria-label={t("刷新")}
            onClick={() => {
              setTick((v) => v + 1);
              void reloadAll();
            }}
          >
            <ArrowClockwise size="0.875rem" aria-hidden />
          </button>
        </span>
      </div>
      <div
        className="wsfb-list"
        onContextMenu={(e) => {
          /* 空白区右键 = 根目录菜单(与右栏 file-tree-list 同语义)。 */
          e.preventDefault();
          ops.openMenu(e.clientX, e.clientY, null);
        }}
      >
        {body}
      </div>
      {menuPos && (
        <WsfbMoreMenu root={root} position={menuPos} onClose={() => setMenuPos(null)} />
      )}
      <FileTreeOverlays
        root={root}
        notice={ops.notice}
        menu={ops.menu}
        prompt={ops.prompt}
        promptError={ops.promptError}
        openPrompt={ops.openPrompt}
        copyPath={ops.copyPath}
        revealInFileManager={ops.revealInFileManager}
        trash={ops.trash}
        closeMenu={ops.closeMenu}
        closePrompt={ops.closePrompt}
        submitPrompt={ops.submitPrompt}
      />
    </div>
  );
}

/** 入口组件:远程工作区给通用降级(侧栏浏览器仅本机 fs),其余进浏览器。 */
export function WorkspaceFileBrowser(props: WorkspaceFileBrowserProps) {
  const { list } = useWorkspaces();
  const ws = list.find((w) => w.id === props.workspaceId) ?? null;
  const remote = ws ? findRemoteFileSource(ws) : null;
  if (remote || ws?.wsl) {
    return (
      <div className="wsfb">
        <WsfbChromeTop query="" onQuery={() => {}} changedOnly={false} onExitChanged={() => {}} />
        <div className="filetree-wsl-degraded">
          <b>{t("远程工作区")}</b>
          <span>{t("该工作区的文件在远程宿主上;启用对应来源插件后可在此浏览。")}</span>
        </div>
      </div>
    );
  }
  return <WsfbBrowser {...props} />;
}
