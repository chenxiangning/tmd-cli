/**
 * 编辑区最大化全局开关 —— FileTab 按钮与 AppShell 布局双端消费,
 * 必须是共享 store(usePersistedToggle 的组件内 useState 会两端分叉)。
 * 写法对齐 kernel/tabs.ts;localStorage 持久化(key shell.editorMax)。
 *
 * 语义:最大化且存在 tab 时,仅横向 group 折叠中央幕布;左栏保持可见、
 * 右栏钉住实测宽度(panel-handle.css),编辑区在中间区域撑满;无 tab 时不生效。
 *
 * 遮盖统一(2026-10-11):任何入口切激活会话(顶栏 tab、侧栏行、审批直达、
 * 通知点击、工作台会话链、spawn adopt、快捷键)都广播 activeSessionChanged,
 * 幕布被编辑区盖住时「切会话 = 看不到」——AppShell 装配期装
 * installEditorMaximizedActivationGuard 统一还原,插件调用点零改动(R4 禁
 * 插件 import app-shell,逐点修补不可行)。setActiveSession 同 id 早退不发
 * 事件,显式「点已激活 tab」路径由 SessionTabBar 调 restoreEditorMaximized 兜住。
 */

import { useSyncExternalStore } from "react";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";

const STORAGE_KEY = "shell.editorMax";

let maximized = localStorage.getItem(STORAGE_KEY) === "1";
const listeners = new Set<() => void>();

function setMaximized(value: boolean): void {
  maximized = value;
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  listeners.forEach((fn) => fn());
}

export function toggleEditorMaximized(): void {
  setMaximized(!maximized);
}

/** 最大化态摘除(激活守卫与显式点击共用);非最大化态幂等 no-op。 */
export function restoreEditorMaximized(): void {
  if (maximized) setMaximized(false);
}

/** 激活会话即还原:AppShell 装配期订阅一次,返回退订。已知边界:关闭激活
 *  会话后 host 的 MRU 自动切换同样触发还原——摘激活 tab 者多数正要回幕布,
 *  可接受(见 setActiveSession/removeSession 语义)。 */
export function installEditorMaximizedActivationGuard(): () => void {
  return host.events.on(KernelTopics.activeSessionChanged, () => {
    restoreEditorMaximized();
  });
}

export function useEditorMaximized(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => maximized,
  );
}

