/**
 * 意图画布 · 设置分区页:AI 作画开关 + inbox 路径与格式速览。
 * 偏好落插件本地 localStorage(aiDrawStore),不进 kernel settings。
 */

import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { getActiveWorkspace } from "@kernel/workspace";
import { StyledSelect } from "@kernel/StyledSelect";
import { setAiDrawEnabled, useAiDrawEnabled } from "../aiDrawStore";
import { aiDrawInboxPath } from "../aiDraw";

export function IntentCanvasSettingsTab() {
  const enabled = useAiDrawEnabled();
  const [inboxPath, setInboxPath] = useState<string | null>(null);
  const root = getActiveWorkspace()?.root ?? null;

  useEffect(() => {
    let cancelled = false;
    if (root) {
      aiDrawInboxPath(root)
        .then((path) => {
          if (!cancelled) {
            setInboxPath(path);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [root]);

  return (
    <div className="flex flex-col gap-4 py-3">
      <label className="flex items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-[0.8125rem] text-(--tmd-fg)">{t("对话中 AI 作画")}</span>
          <span className="text-[0.6875rem] text-(--tmd-fg-muted)">
            {t("开启后,发送的消息会自动附带画图指令;AI 按指令把绘图文件写进收件箱,画布自动上稿。")}
          </span>
        </span>
        <StyledSelect
          value={enabled ? "on" : "off"}
          onChange={(value) => setAiDrawEnabled(value === "on")}
          options={[
            { value: "on", label: t("开") },
            { value: "off", label: t("关") },
          ]}
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-[0.8125rem] text-(--tmd-fg)">{t("AI 作画收件箱(当前工作区)")}</span>
        <code className="rounded border border-(--tmd-border) bg-(--tmd-bg-sunken) px-2 py-1 text-[0.6875rem] text-(--tmd-fg-muted)">
          {inboxPath ?? t("(先选择工作区)")}
        </code>
        <span className="text-[0.6875rem] text-(--tmd-fg-muted)">
          {t("文件名 ai-draw-*.json;导入成功后自动移除,失败文件在 inbox/failed/ 留证。")}
        </span>
      </div>
    </div>
  );
}
