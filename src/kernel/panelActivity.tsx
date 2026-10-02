/**
 * 面板可见性 context —— 右栏 latched 保活(2026-10-02 模块打磨轮)后,隐藏面板
 * 不卸载,「卸载即停轮询」的旧免费闸门失效;轮询类 hook 经 usePanelActive()
 * 短路(隐藏态跳过拉取,回切即刷),恢复不可见不轮询的语义。无 Provider 时
 * 恒 true(独立渲染/旧挂载点行为不变)。
 */
import { createContext, useContext } from "react";

const PanelActiveContext = createContext(true);

export const PanelActiveProvider = PanelActiveContext.Provider;

export function usePanelActive(): boolean {
  return useContext(PanelActiveContext);
}
