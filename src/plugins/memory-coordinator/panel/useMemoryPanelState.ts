/**
 * MemoryPanel 状态机 —— useReducer 集中池状态与交互态(prefer-useReducer),
 * 自 MemoryPanel.tsx 拆出(文件规模铁则 + no-high-complexity-react-function)。
 */

import { useCallback, useReducer, useRef } from "react";
import type { MemoryItem } from "../protocol";
import { archiveMemory } from "../phase2/write";
import { memoryPool, resolveProjectIdentity } from "../pool";

type MemoryPanelState = {
  identity: string | null;
  ready: boolean | null;
  poolReason: "not-installed" | "locked" | null;
  count: number;
  items: MemoryItem[];
  query: string;
  kind: string;
  source: string;
  loading: boolean;
  detailOpen: boolean;
  expandedId: number | null;
  selectMode: boolean;
  selected: Set<number>;
  dbPath: string | null;
  archivingId: number | null;
};

const initialState: MemoryPanelState = {
  identity: null,
  ready: null,
  poolReason: null,
  count: 0,
  items: [],
  query: "",
  kind: "all",
  source: "all",
  loading: false,
  detailOpen: false,
  expandedId: null,
  selectMode: false,
  selected: new Set(),
  dbPath: null,
  archivingId: null,
};

type PanelAction =
  | { type: "patch"; patch: Partial<MemoryPanelState> }
  | { type: "removeItem"; id: number };

function panelReducer(state: MemoryPanelState, action: PanelAction): MemoryPanelState {
  if (action.type === "removeItem") {
    return { ...state, items: state.items.filter((m) => m.id !== action.id) };
  }
  return { ...state, ...action.patch };
}

export function useMemoryPanelState(root: string) {
  const [state, dispatch] = useReducer(panelReducer, initialState);
  const patch = useCallback((p: Partial<MemoryPanelState>) => dispatch({ type: "patch", patch: p }), []);

  const removeItem = useCallback(
    async (id: number) => {
      if (!root) return;
      patch({ archivingId: id });
      try {
        const out = await archiveMemory(id, root);
        if (out.ok) dispatch({ type: "removeItem", id });
      } finally {
        /* reject 路径也要抬旗,否则该行移除钮永久转圈。 */
        patch({ archivingId: null });
      }
    },
    [root, patch],
  );

  const reloadEpoch = useRef(0);
  const reload = useCallback(async () => {
    if (!root) return;
    const mine = ++reloadEpoch.current;
    try {
      const id = await resolveProjectIdentity(root);
      if (mine !== reloadEpoch.current) return; /* 工作区已切:过期结果丢弃(评审 MC4) */
      patch({ identity: id });
      if (!id) {
        patch({ ready: false, poolReason: null });
        return;
      }
      const pool = await memoryPool.status();
      if (mine !== reloadEpoch.current) return;
      patch({ ready: pool.ready, poolReason: pool.reason ?? null, count: pool.count, dbPath: pool.dbPath });
      if (!pool.ready) return;
      patch({ loading: true });
      try {
        const list = await memoryPool.recall(id, undefined, 200);
        if (mine !== reloadEpoch.current) return;
        patch({ items: list });
      } finally {
        if (mine === reloadEpoch.current) patch({ loading: false });
      }
    } catch (e) {
      /* recall 遇 db 锁等瞬时失败:保留上次列表,吞掉未处理 rejection(评审 MC4) */
      console.warn("[memory-panel] reload 失败", e);
      if (mine === reloadEpoch.current) patch({ loading: false });
    }
  }, [root, patch]);

  return { state, patch, reload, removeItem };
}
