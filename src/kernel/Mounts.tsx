/**
 * 挂载点渲染器 —— 内核公共组件。
 *
 * 挂载点注册表(getMount)本就在 host,渲染器同属内核机制:
 * app-shell 渲染外壳挂点、插件渲染自己的子挂点(如 composer.statusBar),
 * 都从这里 import,避免插件反向依赖 app-shell。
 *
 * 每个贡献组件包一层 ErrorBoundary:渲染抛错只塌该挂点(console.error 可诊断),
 * 不再卸载整棵 React 树 —— 本地插件(外部代码)使坏代码从理论风险变日常,必须隔离。
 */

import React from "react";
import { host, useHost } from "./host";
import type { MountPoint } from "./plugin";

class MountErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("[mount] 挂点组件渲染失败(该挂点已隔离):", error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* 挂点 key:贡献对象身份 → 稳定串(贡献对象随插件激活常驻注册表,对象身份即
   稳定标识;index 作 key 会在注册表中部增删时错位复用 ErrorBoundary 子树)。 */
const mountKeys = new WeakMap<object, string>();
let mountKeySeq = 0;

function mountKey(contribution: object): string {
  let key = mountKeys.get(contribution);
  if (!key) {
    key = `mount-${++mountKeySeq}`;
    mountKeys.set(contribution, key);
  }
  return key;
}

export function Mounts({ point }: { point: MountPoint }) {
  useHost();
  return (
    <>
      {host.getMount(point).map((c) => {
        const Comp = c.component;
        return (
          <MountErrorBoundary key={mountKey(c)}>
            <Comp />
          </MountErrorBoundary>
        );
      })}
    </>
  );
}
