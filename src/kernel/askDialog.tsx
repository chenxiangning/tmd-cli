/**
 * askDialog —— ConfirmDialog 的命令式(promise 化)形态(kernel 通用原语)。
 *
 * 为什么要有命令式版本:组件形态的确认弹层必须「宿主组件此刻在挂」,而关闭闸
 * 一类场景恰恰做不到 —— 脏 tab 切走即卸载(非 keepAlive),问「要不要丢稿」时
 * 没有任何组件在场替它渲染弹窗。askDialog 自带临时 React root 问完即拆,可用性
 * 只取决于本模块已加载(插件 activate 静态引入),与任何组件的挂载时机无关。
 *
 * 消费:files(file: 脏文档关闭闸)、ssh(ssh-file 脏远端文件关闭闸);
 * journal 文章 tab 是 keepAlive(tab 在挂 = 闸在),走组件态 ArticleDiscardGate,
 * 两族弹窗共用 ConfirmDialog 形制(标题/文案/按钮一致)。
 *
 * 结算纪律:首答即决(确认 true / 取消·Esc·点背板 false),双路触发按首次结算;
 * root 卸载延后一拍 —— 事件处理器同步卸载自家 root 会打断 React 事件派发。
 */

import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { ConfirmDialog } from "./DialogConfirm";

export function askDialog(options: {
  title: string;
  message: ReactNode;
  /** 确认钮文案;动词型(丢弃/删除)由调用方传入 */
  confirmLabel?: string;
  /** 危险确认:主钮红底 + 聚焦取消钮(ConfirmDialog 同款语义) */
  danger?: boolean;
}): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    const root = createRoot(host);
    root.render(
      <ConfirmDialog
        title={options.title}
        message={options.message}
        confirmLabel={options.confirmLabel}
        danger={options.danger}
        onConfirm={() => settle(true)}
        onClose={() => settle(false)}
      />,
    );
  });
}
