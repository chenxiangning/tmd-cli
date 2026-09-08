/**
 * 记忆合并 hook —— 自 MemoryPanel.tsx 拆出(文件规模铁则)。
 *
 * 选 2 条以上重复记忆折叠为一条:content 取首条表述,经 omp 官方管线
 * mergeMemories 代写;引擎回复成功后复查仍在库条数(模型可能未执行合并)。
 */

import { useState } from "react";
import { getSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { mergeMemories } from "../phase2/write";
import { memoryPool, resolveProjectIdentity } from "../pool";
import type { MemoryItem } from "../protocol";

export function useMemoryMerge({
  root,
  filtered,
  selected,
  reload,
  setSelected,
  setSelectMode,
}: {
  root: string;
  filtered: MemoryItem[];
  selected: Set<number>;
  reload: () => Promise<void>;
  setSelected: (s: Set<number>) => void;
  setSelectMode: (v: boolean) => void;
}) {
  const [merging, setMerging] = useState(false);
  const [mergeNote, setMergeNote] = useState<string | null>(null);

  const startMerge = () => {
    const chosen = filtered.filter((m) => selected.has(m.id));
    if (chosen.length < 2 || !root) return;
    setMerging(true);
    setMergeNote(t("合并中…(经 omp 官方管线,可能需数十秒)"));
    const ids = chosen.map((m) => m.id);
    void mergeMemories(ids, chosen[0].content, root, {
      engine: getSettingsState().settings.memoryDistillEngine,
      model: getSettingsState().settings.memoryDistillModel || undefined,
    }).then(async (out) => {
      setMerging(false);
      if (!out.ok) {
        setMergeNote(t("失败: {detail}", { detail: out.detail || t("代写引擎无响应") }));
        return;
      }
      await reload();
      const still = (await memoryPool.recall((await resolveProjectIdentity(root)) ?? "", undefined, 200))
        .filter((m) => ids.includes(m.id));
      if (still.length > 0) {
        setMergeNote(t("引擎回复成功但 {n} 条仍在(模型可能未执行合并):{detail}", { n: still.length, detail: out.detail.slice(0, 80) }));
      } else {
        setMergeNote(t("已合并"));
        setSelected(new Set());
        setSelectMode(false);
      }
    });
  };

  return { merging, mergeNote, startMerge };
}
