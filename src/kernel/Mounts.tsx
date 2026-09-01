/**
 * 挂载点渲染器 —— 内核公共组件。
 *
 * 挂载点注册表(getMount)本就在 host,渲染器同属内核机制:
 * app-shell 渲染外壳挂点、插件渲染自己的子挂点(如 composer.statusBar),
 * 都从这里 import,避免插件反向依赖 app-shell。
 */

import { host, useHost } from "./host";
import type { MountPoint } from "./plugin";

export function Mounts({ point }: { point: MountPoint }) {
  useHost();
  return (
    <>
      {host.getMount(point).map((c, i) => {
        const Comp = c.component;
        return <Comp key={i} />;
      })}
    </>
  );
}
