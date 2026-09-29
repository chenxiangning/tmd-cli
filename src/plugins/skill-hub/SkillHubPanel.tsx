/**
 * 右栏 Skills 概览面板 ── 已安装记录统计 + 每来源计数(商店/本地导入),
 * 底部「打开管理」进中央 tab。轻量只读;清单/导入/删除全在中央 tab。
 * v2 闭环:计数 = 安装记录(skillRegistry),不再扫十家目录。
 */

import { useEffect } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { loadSkillRegistry, useSkillRegistry } from "@plugins/cli-shared/skillRegistry";
import { openSkillHubTab } from "./hubTab";

export function SkillHubPanel() {
  const { records, loaded } = useSkillRegistry();
  useEffect(() => {
    void loadSkillRegistry(); /* 面板只读记录;十家目录扫描惰性留给本地导入视图 */
  }, []);
  const storeCount = records.filter((r) => r.source === "store").length;
  const importCount = records.filter((r) => r.source === "import").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!loaded ? (
          <div className="px-2 py-1 text-xs text-(--tmd-fg-faint)">{t("正在读取安装记录…")}</div>
        ) : records.length === 0 ? (
          <div className="px-2 py-1 text-xs text-(--tmd-fg-faint)">
            {t("尚未安装;从技能商店安装或本地导入")}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={openSkillHubTab}
              className="flex w-full items-center justify-between rounded px-2 py-[5px] text-left text-xs hover:bg-(--tmd-bg-hover)"
            >
              <span className="truncate">{t("商店安装")}</span>
              <span className="ml-2 shrink-0 text-(--tmd-fg-faint)">{storeCount}</span>
            </button>
            <button
              type="button"
              onClick={openSkillHubTab}
              className="flex w-full items-center justify-between rounded px-2 py-[5px] text-left text-xs hover:bg-(--tmd-bg-hover)"
            >
              <span className="truncate">{t("本地导入")}</span>
              <span className="ml-2 shrink-0 text-(--tmd-fg-faint)">{importCount}</span>
            </button>
          </>
        )}
      </div>
      <div className="border-t border-(--tmd-border) p-2">
        <div className="mb-1 text-[10px] text-(--tmd-fg-faint)">
          {t("已安装 {n} 个技能", { n: records.length })}
        </div>
        <button
          type="button"
          onClick={openSkillHubTab}
          className="flex w-full items-center justify-center gap-1 rounded border border-(--tmd-border) px-2 py-1 text-xs hover:bg-(--tmd-bg-hover)"
        >
          <ArrowSquareOut size={12} aria-hidden="true" />
          {t("打开管理")}
        </button>
      </div>
    </div>
  );
}
