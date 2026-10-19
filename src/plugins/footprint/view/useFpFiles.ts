/**
 * footprint 文件/会话动作:抽屉文件行 → 宽 diff 面板、resume、打开文件/
 * 所在文件夹(真实通道在 dataSource)。自 FootprintView 拆出守 300 行铁则。
 */
import React, { useCallback, useState } from "react";
import { t } from "@kernel/i18n";
import { getWorkspaces } from "@kernel/workspace";
import type { DaySessionRow } from "@plugins/workbench/journal/daySessions";
import { openDaySessionRow } from "@plugins/workbench/journal/sessionRef";
import type { CkptPatch } from "@kernel/ipc";
import { fileBatch, loadPatch, openFileExternally, revealInFileManager } from "../dataSource";
import type { FpCardView, FpDayDetail } from "../dataSource";

/** 当前选中文件的全视图态(diff 面板与抽屉选中行共用)。 */
export interface FileSel {
  path: string;
  patch: CkptPatch | null;
  loading: boolean;
  degraded: boolean;
  engine: string;
  add: number;
  del: number;
}

export interface FpFileActions {
  fileSel: FileSel | null;
  setFileSel: React.Dispatch<React.SetStateAction<FileSel | null>>;
  pickFile: (path: string) => void;
  resumeSession: (sid: string) => void;
  openFile: (path: string) => void;
  revealFile: (path: string) => void;
}

export function useFpFiles(
  detail: FpDayDetail | null,
  card: FpCardView | null,
  showToast: (msg: string) => void,
): FpFileActions {
  const [fileSel, setFileSel] = useState<FileSel | null>(null);

  const pickFile = useCallback(
    (path: string) => {
      if (!detail || !card) return;
      const rollup = detail.rollup;
      const stat = rollup?.files[path];
      if (!rollup || !stat) return;
      const batch = fileBatch(rollup, stat);
      const engine = stat.refs.map((sid) => rollup.sessions[sid]?.engine).find(Boolean) ?? "?";
      setFileSel({ path, patch: null, loading: batch !== null, degraded: batch === null, engine, add: stat.add, del: stat.del });
      if (batch) {
        void loadPatch(batch.cwd, batch.batchId, path).then((patch) => {
          setFileSel((prev) => (prev && prev.path === path ? { ...prev, patch, loading: false } : prev));
        });
      }
      /* 宽面板在主流底部展开后滚入视野 */
      window.setTimeout(() => {
        document.getElementById("fp-main-diff")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 60);
    },
    [detail, card],
  );

  const resumeSession = useCallback(
    (sid: string) => {
      if (!detail) return;
      const row: DaySessionRow | undefined = detail.rows.find((r) => r.id === sid);
      if (row) {
        openDaySessionRow(row, getWorkspaces());
      } else {
        showToast(t("该会话不在当日扫描清单(账本索引仍保留)"));
      }
    },
    [detail, showToast],
  );

  const openFile = useCallback(
    (path: string) => {
      void openFileExternally(path).then((ok) => {
        if (!ok) showToast(t("打开失败:系统未注册默认程序"));
      });
    },
    [showToast],
  );

  const revealFile = useCallback(
    (path: string) => {
      void revealInFileManager(path).then((ok) => {
        if (!ok) showToast(t("打开所在文件夹失败"));
      });
    },
    [showToast],
  );

  return { fileSel, setFileSel, pickFile, resumeSession, openFile, revealFile };
}

