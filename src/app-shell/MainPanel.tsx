// AppShell 中央幕布(terminal + composer 上下结构),自 AppShell.tsx 按「纯结构拆分、行为不变」拆出
import { Fragment, useEffect } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, useGroupRef } from "react-resizable-panels";
import { host } from "@kernel/host";
import {
  COMPOSER_RESIZE_STEP,
  COMPOSER_STAGE_SIZE,
  useComposerStage,
} from "@kernel/composerStage";
import { Mounts } from "@kernel/Mounts";
import { useSessionTabs } from "@kernel/sessionTabs";
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
  /* 保活集合 = tab 条 ids(+ activeId 不在条内的兜底),见下方 keep-alive 注释。 */
  const { ids: tabIds, tile } = useSessionTabs();
  const kept =
    activeId && !tabIds.includes(activeId) ? [...tabIds, activeId] : tabIds;
  /* 平铺显示(参照 codeg tile):开关持久于 sessionTabs store,≥2 tab 才成屏;
     焦点 = host 活跃指针(点列即 switchTab),composer 随指针走,不新增状态。 */
  const tiling = tile && kept.length >= 2;
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
        {tiling ? (
          /* 平铺:tab 条全部会话并排同屏,点列 = switchTab(setActiveSession,
             已读/状态刷新/composer 换绑全走现有链路);composer 不隐藏,
             始终编辑活跃会话(与 codeg 每 pane 自带输入的差异:tmd 幕布外输入面唯一) */
          <PanelGroup orientation="horizontal" id="tmd.session.tile">
            {kept.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && <PanelResizeHandle className="panel-handle panel-handle-v" />}
                <Panel defaultSize={100 / kept.length} minSize={12} id={`tmd.tile.${id}`}>
                  <div className="h-full w-full" onPointerDownCapture={() => host.setActiveSession(id)}>
                    <TerminalView sessionId={id} active={id === activeId} />
                  </div>
                </Panel>
              </Fragment>
            ))}
          </PanelGroup>
        ) : (
          /* keep-alive:tab 条内会话全部保持挂载,非激活 display:none —— 切 tab
             零重放零遮罩(TerminalView 重挂载 = 全量回放输出缓冲 + 0.5s 静默撤罩)。
             tab 条容量(sessionTabsMax)即保活上限,挤除即卸载;activeId 不在条内
             的边缘路径补挂。 */
          kept.map((id) => (
            <div
              key={id}
              className="h-full w-full"
              style={{ display: id === activeId ? undefined : "none" }}
            >
              <TerminalView sessionId={id} active={id === activeId} />
            </div>
          ))
        )}
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
