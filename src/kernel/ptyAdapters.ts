/**
 * PTY spec 适配注册表 —— 来源类插件(如 WSL)对 spawn spec 的包装贡献点。
 *
 * 为什么存在:某类工作区(UNC cwd = WSL 发行版)需要把本地形态的 spawn spec
 * 包装成远端形态(wsl.exe 登录 shell),内置终端也要直落发行版 shell —— 这些
 * 是来源插件的语义,kernel 的 spawn 链只认注册表:插件 activate 时注册,
 * 禁用插件重启后不激活 = 注册表为空 = spec 原样走本地(拔插件即彻底退场)。
 *
 * 两个面:
 * - specWrapper:命令包装链(sessionSpawn 在 profile 无自带 spawnTransform 时
 *   依注册顺序应用;与 spawnTransform 互斥的裁决不变 —— transform 是 profile
 *   对进程形态的完全接管,来源包装不再叠加);
 * - shellSpecProvider:内置终端 spec 构建(首个 appliesTo 命中者接管,全不
 *   命中走 kernel 默认本地 shell)。
 */

import type { SpawnSpec } from "./ipc";
import type { Workspace } from "./workspace";

type SpecWrapper = (spec: SpawnSpec) => Promise<SpawnSpec>;

let wrappers: SpecWrapper[] = [];

/** 注册 spec 包装(activate 期调用);返回退订函数。 */
export function registerSpecWrapper(wrapper: SpecWrapper): () => void {
  wrappers.push(wrapper);
  return () => {
    wrappers = wrappers.filter((w) => w !== wrapper);
  };
}

/** 依注册顺序应用全部包装(无注册者 = 原样返回)。 */
export async function applySpecWrappers(spec: SpawnSpec): Promise<SpawnSpec> {
  let out = spec;
  for (const wrapper of wrappers) {
    out = await wrapper(out);
  }
  return out;
}

export interface ShellSpecProvider {
  /** 该提供者服务哪些工作区(首个命中者接管内置终端 spec 构建)。 */
  appliesTo(ws: Workspace): boolean;
  /** 标题等展示语义由提供者自决(kernel 不注入来源专属串)。 */
  build(ws: Workspace): Promise<SpawnSpec>;
}

let shellProviders: ShellSpecProvider[] = [];

/** 注册内置终端 spec 提供者(activate 期调用);返回退订函数。 */
export function registerShellSpecProvider(provider: ShellSpecProvider): () => void {
  shellProviders.push(provider);
  return () => {
    shellProviders = shellProviders.filter((p) => p !== provider);
  };
}

/** 首个命中提供者;全不命中 = null(kernel 走默认本地 shell)。 */
export function findShellSpecProvider(ws: Workspace): ShellSpecProvider | null {
  return shellProviders.find((p) => p.appliesTo(ws)) ?? null;
}
