// AppShell 中央幕布(terminal + composer 上下结构),自 AppShell.tsx 按「纯结构拆分、行为不变」拆出
import { useEffect } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, useGroupRef } from "react-resizable-panels";
import { host } from "@kernel/host";
import {
  COMPOSER_RESIZE_STEP,
  COMPOSER_STAGE_SIZE,
  useComposerStage,
} from "@kernel/composerStage";
import { Mounts } from "@kernel/Mounts";
import { TerminalView } from "@kernel/TerminalView";

/**
 * 中央幕布 —— 上下结构:terminal(无 session 时占位) + composer,高度可拖。
 * 文件预览不在此层:提升为外层水平 group 的独立通栏面板(见 AppShell),
 * 打开文件时 terminal 不再被横向压缩。
 */
export function MainPanel() {
  /* SSH / 内置终端会话无 composer:幕布即输入面(触发符/审批线等都是 CLI 语义)。 */
  const activeId = host.getActiveSessionId();
  const activeKind = host.getSessions().find((s) => s.id === activeId)?.kind;
  /* 对话框五段式高度:composer 插件工具栏的 ↑↓ 写 kernel composerStage,这里消费。
     实测本库命令式 setLayout/panelRef.resize 在嵌套 group 下会被静默回滚,不可用;
     separator 键盘路径(每键 5%)走库自身状态更新,可靠 —— 借它驱动:
     键数 = round((目标% − 当前%)/5),从 groupRef.getLayout() 读当前值。 */
  const stage = useComposerStage();
  const groupRef = useGroupRef();

  useEffect(() => {
    /* activeId 入依赖:切会话时 PanelGroup 重挂载回 defaultSize,需按当前 stage 重放。
       min 段 composer 不在 Panel 体系内(下方裸 div 直挂),无 separator 可调,直接跳过 */
    if (stage === "min") return;
    const group = document.querySelector('[data-group][id="tmd.main.vertical"]');
    const sep = group?.querySelector(":scope > [data-separator]");
    const current = groupRef.current?.getLayout().composer ?? 30;
    const steps = Math.round((COMPOSER_STAGE_SIZE[stage] - current) / COMPOSER_RESIZE_STEP);
    const key = steps > 0 ? "ArrowUp" : "ArrowDown";
    for (let i = 0; i < Math.abs(steps); i++) {
      sep?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
  }, [stage, activeId, groupRef]);

  /* 无活跃 session:整页渲染 welcome(引擎探针/安装 + 近期会话),
     terminal 与 composer 一并替换 —— 首页即初始形态。 */
  if (!activeId) {
    return <Mounts point="editorCenter.welcome" />;
  }

  return (
    <PanelGroup orientation="vertical" id="tmd.main.vertical" groupRef={groupRef}>
      <Panel defaultSize={70} minSize={30} id="canvas">
        <TerminalView key={activeId} sessionId={activeId} />
      </Panel>
      {activeKind === "ssh" || activeKind === "shell" ? null : stage === "min" ? (
        /* min 段:composer 退出 Panel 体系,挂裸 div —— 内容仅工具栏条(Composer 隐藏输入区),
           高度 = 内容自身,与窗口底边零缝隙;固定百分比永远对不齐工具栏像素高。
           离开 min 时 Panel/Separator 重挂载回 defaultSize,上方 effect 按目标段重放键步 */
        <div className="shrink-0">
          <Mounts point="editorCenter.composer" />
        </div>
      ) : (
        <>
          <PanelResizeHandle className="panel-handle panel-handle-h" />
          <Panel defaultSize={30} minSize={10} id="composer">
            <Mounts point="editorCenter.composer" />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
