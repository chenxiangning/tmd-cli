/**
 * workspace 插件 —— 左侧"工作区"区块,管理多工作区并行。
 *
 * 设计:
 * - 工作区 = 顶层容器,存 root cwd + name;持久化在 ~/.tmd-cli/workspaces.json
 * - 全部工作区并列展开,点击选中(作为新建会话默认 cwd)
 * - 删除工作区只影响列表,不影响其下历史会话(session 通过 workspaceId 关联,
 *   无 workspace 时归到 default)
 */

import { useState } from "react";
import type { Plugin } from "@kernel/plugin";
import { useHost } from "@kernel/host";
import {
  addWorkspace,
  removeWorkspace,
  setActiveWorkspace,
  useWorkspaces,
} from "@kernel/workspace";

function WorkspaceSection() {
  useHost();
  const { list, activeId } = useWorkspaces();
  const [newPath, setNewPath] = useState("");
  const [showInput, setShowInput] = useState(false);

  function commitAdd() {
    const trimmed = newPath.trim();
    if (!trimmed) {
      setShowInput(false);
      return;
    }
    addWorkspace(trimmed);
    setNewPath("");
    setShowInput(false);
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex items-center justify-between px-1 text-xs text-neutral-500">
        <span>工作区</span>
        <button
          title="添加工作区"
          className="rounded px-1 hover:bg-neutral-800"
          onClick={() => setShowInput((v) => !v)}
        >
          +
        </button>
      </div>

      {showInput && (
        <input
          autoFocus
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitAdd();
            if (e.key === "Escape") setShowInput(false);
          }}
          onBlur={commitAdd}
          placeholder="/绝对/路径"
          className="rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none placeholder:text-neutral-600"
        />
      )}

      {list.map((ws) => {
        const isActive = ws.id === activeId;
        return (
          <div
            key={ws.id}
            className={`group flex items-center gap-1 rounded px-2 py-1 text-sm ${
              isActive ? "bg-neutral-800" : "hover:bg-neutral-800/60"
            }`}
          >
            <button
              className="flex flex-1 items-center gap-1 text-left"
              onClick={() => setActiveWorkspace(ws.id)}
              title={ws.root}
            >
              <span className="text-sky-400">▸</span>
              <span className="truncate">{ws.name}</span>
            </button>
            {list.length > 1 && (
              <button
                title="删除工作区"
                className="invisible rounded px-1 text-neutral-500 hover:bg-neutral-700 hover:text-red-400 group-hover:visible"
                onClick={() => removeWorkspace(ws.id)}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const workspacePlugin: Plugin = {
  id: "workspace",
  activate(ctx) {
    ctx.contribute("leftSidebar.section", {
      order: 0,
      component: WorkspaceSection,
    });
  },
};
