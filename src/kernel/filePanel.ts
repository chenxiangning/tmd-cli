/**
 * 右侧面板注册表 + 激活/钉住状态 store。
 *
 * kernel 只提供「tab 注册 + 激活/钉住」通用原语,不预知任何业务面板
 * (files/git/search 都是产品路线图,不是内核知识);面板 id/图标/组件
 * 由各自插件 activate 时注册:
 *   files 插件 → { id: "files", label: "文件", ... }
 *   git 插件   → { id: "git",   label: "Git", ... }
 * 外壳(AppShell 右栏 / 右缘 PanelRail)只按注册表渲染 —— 新增面板零改外壳。
 * 钉住清单按面板 id 持久化 localStorage(key tmd.filePanel.pinned.v1),重启原样恢复。
 */

import type { ComponentType } from "react";
import { createSubscribable } from "./subscribable";

/** 面板图标的最小 props 面(兼容 @phosphor-icons-react 图标组件)。 */
export type FilePanelIcon = ComponentType<{
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/** 插件注册的右栏面板。 */
export interface FilePanelContribution {
  /** 全局唯一 id(插件自带,如 "files"/"git");重复注册即抛错。 */
  id: string;
  /** tab 的 aria/title 文案。 */
  label: string;
  icon: FilePanelIcon;
  /** 面板内容组件(激活时整栏渲染)。 */
  component: ComponentType;
  /** 面板数据刷新(可选):面板头工具条刷新钮与键位命令(panel.refresh)调用;
   *  返回 Promise 则按钮转到 settle。实现同样经插件内 store/引用转发到面板组件
   *  (如 FileTree 的 reload 全量重拉,files 侧单一真源在 treeHandles.refreshFiles)。 */
  refresh?: () => void | Promise<void>;
  /** 新建文件/文件夹(可选):面板头工具条按钮与键位命令(panel.newFile /
   *  panel.newFolder)调用;缺省 = 命令 when 拦下、工具条按钮置灰。 */
  newFile?: () => void;
  newFolder?: () => void;
  /** tab 排序,小的在前;缺省 0。面板与 rail 动作共用地带(按此并序渲染)。 */
  order?: number;
  /** rail 分组(2026-09-29 归组):同组相邻渲染,相邻两组之间画分隔线;
   *  壳只比较相邻组值是否相等,不认识任何组语义;缺省 = 不分组(无分隔线)。 */
  railGroup?: string;
  /** 钉到 rail 底部簇(与 ⋯ 管理钮同挂 flex 空隙之后):排序/分组语义不变,归属插件自声明。 */
  railBottom?: boolean;
  /** 注册即钉到 toolbar;缺省 true。 */
  pinnedByDefault?: boolean;
  /** 一次性补钉(review 裁决:收进注册面,禁插件旁路直连):老用户 persisted 清单
   *  先于面板存在时新 id 落 ⋯ 菜单不可见;仅自动钉一次并留痕,手动取消钉后不复活。 */
  pinOnce?: boolean;
  /** rail 联动的中央管理 tab(可选):open 幂等打开(重复 = 聚焦已有)。
   *  中央 tab 之间互不互斥、也不随右栏切换/收起被关(与普通 tab 同权,
   *  生命周期归用户);外壳只在面板打开方向调用 open,不做任何关闭联动。
   *  外壳只调用不认识语义;缺省 = 纯右栏面板,无中央联动。 */
  centerTab?: { open: () => void };
}

/* ── 钉住清单持久化 ──
 * 纯 UI 态,localStorage 即可,不进 settings schema(对齐 sidebarActions /
 * PinnedSessions 折叠态惯例)。按面板 id 存全量 string[],key 存在即权威:
 * 注册序(插件 activate)晚于模块加载,registerFilePanel 按表查钉住,
 * 缺项回落 pinnedByDefault;插件拔出后清单保留原 id,重启用原样恢复。 */

/** 存储 key;值为 string[](已钉面板 id 全集,含用户手动钉的缺省不钉面板)。 */
const PINNED_STORAGE_KEY = "tmd.filePanel.pinned.v1";

/** 读持久化钉住清单;key 缺失/脏数据/无 Web Storage(node 测试环境)返回 null。 */
function loadPinnedIds(): ReadonlySet<string> | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PINNED_STORAGE_KEY) ?? "null");
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return null;
  }
}

/** 模块加载时读一次(此后不变);togglePinned 是唯一写点,全量覆写。 */
const persistedPinnedIds: ReadonlySet<string> | null = loadPinnedIds();

function persistPinnedIds(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* 写失败静默(隐私模式/存储不可用):只丢持久化,不影响本会话状态。 */
  }
}

interface FilePanelState {
  /** 已注册面板(按 order 升序);数组不可变,注册时整体替换。 */
  panels: readonly FilePanelContribution[];
  /** 当前激活面板 id;首个注册面板自动成为初始激活。 */
  mode: string;
  /** 钉在 toolbar 外显的面板 id。 */
  pinnedIds: ReadonlySet<string>;
}

const state: FilePanelState = {
  panels: [],
  mode: "",
  pinnedIds: new Set(),
};

const store = createSubscribable<FilePanelState>(state);

/** 提交当前 state 为新快照并通知订阅者。 */
function commit(): void {
  store.commit({ panels: state.panels, mode: state.mode, pinnedIds: new Set(state.pinnedIds) });
}

/** 注册右栏面板(插件 activate 内调用)。重复 id 抛错,与 registerCliProfile 同纪律。 */
export function registerFilePanel(panel: FilePanelContribution): void {
  if (state.panels.some((p) => p.id === panel.id)) {
    throw new Error(`右栏面板重复注册: ${panel.id}`);
  }
  state.panels = [...state.panels, panel].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const pinned = persistedPinnedIds ? persistedPinnedIds.has(panel.id) : (panel.pinnedByDefault ?? true);
  if (pinned) {
    state.pinnedIds = new Set([...state.pinnedIds, panel.id]);
  }
  if (!state.mode) state.mode = panel.id;
  commit();
  if (panel.pinOnce) ensurePanelPinned(panel.id);
}

/** 撤销通道(激活失败回滚/熔断摘除):钉住清单保留原 id(重启用原样恢复,同拔出语义)。 */
export function removeFilePanel(id: string): void {
  if (!state.panels.some((p) => p.id === id)) return;
  state.panels = state.panels.filter((p) => p.id !== id);
  if (state.mode === id) state.mode = state.panels[0]?.id ?? "";
  commit();
}

export function setFilePanelMode(id: string): void {
  if (state.mode === id) return;
  state.mode = id;
  commit();
}

export function togglePinned(id: string): void {
  const next = new Set(state.pinnedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  state.pinnedIds = next;
  persistPinnedIds(next);
  commit();
}

/** 一次性把新面板/rail 动作钉进 toolbar(注册面 pinOnce 选项内部调用,
 *  不导出——钉住写面只走注册面,插件无旁路)。
 *  留痕先行:marker 一查一写在任何早退之前 —— 用户手动取消钉后重启,
 *  marker 已存在即不再自动钉(「取消后不复活」契约,无清单路径同守)。
 *  合并写防截断(2026-10-04 二轮评审 P0):persisted 在则写「原清单 ∪ {id}」,
 *  不走 togglePinned 的全量覆写 —— 插件串行激活,此刻未注册面板/rail 动作
 *  不在 state 快照,覆写会把它们的钉住截断丢盘;persisted 缺(新装)则只入
 *  state 不落盘,提前造权威清单会反向丢掉其它面板的 pinnedByDefault 播种。 */
function ensurePanelPinned(id: string): void {
  const marker = `tmd.filePanel.autopin.${id}`;
  try {
    if (localStorage.getItem(marker)) return;
    localStorage.setItem(marker, "1");
  } catch {
    return;
  }
  if (state.pinnedIds.has(id)) return; /* 已钉(默认播种/清单在列):只补留痕 */
  state.pinnedIds = new Set([...state.pinnedIds, id]);
  if (persistedPinnedIds) persistPinnedIds(new Set([...persistedPinnedIds, id]));
  commit();
}

/** rail 直挂动作(sidebarActions.rail)的钉住登记:与面板同规则 —— persisted
 *  清单存在即权威(缺 id = 不钉,可经 ⋯ 菜单勾回),清单缺失回落 pinnedByDefault;
 *  只入 state 不落盘,用户首次勾选才写 tmd.filePanel.pinned.v1。
 *  pinOnce = 面板 pinOnce 同语义的一次性补钉(存量清单无此 id 时自动钉一次,
 *  手动取消后不复活;入口迁移类动作用,先例 system-proxy 2026-10-04)。 */
export function registerRailActionPin(id: string, pinnedByDefault = true, pinOnce = false): void {
  const pinned = persistedPinnedIds ? persistedPinnedIds.has(id) : pinnedByDefault;
  if (pinned && !state.pinnedIds.has(id)) {
    state.pinnedIds = new Set([...state.pinnedIds, id]);
    commit();
  }
  if (pinOnce) ensurePanelPinned(id);
}

export function getFilePanels(): readonly FilePanelContribution[] {
  return state.panels;
}

export function getFilePanelMode(): string {
  return state.mode;
}

export function getPinnedPanelIds(): readonly string[] {
  return Array.from(state.pinnedIds);
}

export function useFilePanel(): FilePanelState {
  return store.useStore();
}
