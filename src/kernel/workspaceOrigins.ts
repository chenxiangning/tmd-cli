/**
 * 工作区来源注册表 —— 工作区「从哪来」的扩展协议。
 *
 * 为什么存在:工作区面板(过滤 chip/徽章/添加弹层/新建会话)不该知晓任何
 * 具体来源(如 WSL);来源插件 activate 时注册本协议的全部或部分成员,
 * 禁用插件重启后不激活 = 注册表为空,面板只留内建形态(数据仍在,专属 UI
 * 与能力随插件退场)。
 *
 * 成员职责:
 * - id/label/matches:侧栏过滤 chip(持久化值 = id)与工作区归类;
 * - badge:工作区行徽章(如发行版标识);
 * - spawnCliSession:该来源工作区的新建 CLI 会话适配(命中返回 true 即接管,
 *   不走本地 PTY spawn;未注册/未命中走默认本地 spawn);
 * - filterCliProfiles / sessionMenuNote:新建会话菜单对该来源工作区的引擎行
 *   过滤与提示行;
 * - addTab:添加工作区弹层的来源 tab(组件归来源插件,本协议只递 onAdded)。
 */

import type { ComponentType } from "react";
import { createSubscribable } from "./subscribable";
import type { CliProfile, RemoteExec } from "./cli";
import type { Workspace } from "./workspace";

/** 添加工作区弹层来源 tab 的组件 props。 */
export interface WorkspaceOriginAddTabProps {
  /** 添加成功(来源插件自行 addWorkspace 后回调,弹层关闭)。 */
  onAdded: () => void;
}

export interface WorkspaceOrigin {
  /** 稳定 id(settings.workspaceOriginFilter 持久化值;勿与内建 "local" 冲突)。 */
  id: string;
  /** 侧栏过滤 chip 文案。 */
  label: string;
  /** 工作区是否属于该来源(徽章显隐 + 过滤 + 「本地」取反定义)。 */
  matches(ws: Workspace): boolean;
  /** 该来源工作区是否查询本机 CLI 磁盘历史;缺省 true(默认本机)。远程来源
   *  (如 WSL)置 false:本机扫描既查不到远端会话,还可能被同路径本机数据
   *  污染 —— 历史与本机严格区分,活会话照常展示。 */
  localDiskHistory?: boolean;
  /** 工作区行徽章(缺省无)。 */
  badge?(ws: Workspace): { text: string; title?: string } | undefined;
  /** 新建 CLI 会话的远程适配;返回 true = 已接管。 */
  spawnCliSession?(ws: Workspace, profile: CliProfile): boolean;
  /** 新建会话菜单的引擎行过滤(未注册 = 全量)。 */
  filterCliProfiles?(ws: Workspace, profiles: CliProfile[]): CliProfile[];
  /** 新建会话菜单的提示行(未注册/null = 无)。 */
  sessionMenuNote?(ws: Workspace): string | null;
  /** 添加工作区弹层的来源 tab(缺省 = 弹层只有本地目录)。 */
  addTab?: { label: string; component: ComponentType<WorkspaceOriginAddTabProps> };
  /** 远程磁盘通道(来源提供传输,引擎适配器提供解析):来源工作区的历史
   *  扫描/状态回填改走远端;null = 该工作区当前无通道(如主机配置已删)。 */
  remoteExec?(ws: Workspace): RemoteExec | null;
  /** 打开来源工作区的远程磁盘会话(远程 resume,如 SSH 包装 + --resume);
   *  返回 true = 已接管,不走本地 openDiskSession。 */
  openRemoteDiskSession?(ws: Workspace, profile: CliProfile, cliSessionId: string): boolean;
  /** 新建会话菜单标题(如「新建 WSL 会话」;缺省「新建会话」)。 */
  newSessionLabel?(ws: Workspace): string;
}

let origins: WorkspaceOrigin[] = [];
const store = createSubscribable<{ origins: readonly WorkspaceOrigin[] }>({ origins });

/** 注册工作区来源(activate 期调用);返回退订函数。 */
export function registerWorkspaceOrigin(origin: WorkspaceOrigin): () => void {
  origins = [...origins, origin];
  store.commit({ origins });
  return () => {
    origins = origins.filter((o) => o !== origin);
    store.commit({ origins });
  };
}

/** 已注册来源(侧栏过滤 chip 列表来源,顺序 = 注册序)。 */
export function listWorkspaceOrigins(): readonly WorkspaceOrigin[] {
  return origins;
}

/** 工作区归属的来源(首个 matches 命中;无 = 本地目录工作区)。 */
export function findWorkspaceOrigin(ws: Workspace): WorkspaceOrigin | null {
  return origins.find((o) => o.matches(ws)) ?? null;
}

/** React 订阅端(面板随插件注册/注销重渲)。 */
export function useWorkspaceOrigins(): readonly WorkspaceOrigin[] {
  return store.useStore().origins;
}
