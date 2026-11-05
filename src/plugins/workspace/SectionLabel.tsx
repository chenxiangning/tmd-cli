/**
 * 工作区内分组小节头共享件 —— PTY / RPC 分区标识(2026-11-05 图 2 结构定稿)。
 * 图标列与工作区文件夹图标垂直对齐(容器内 20px 列,与树线同位,几何见
 * workspace-sessions.css --workspace-tree-indent);标签背景遮蔽树线(小节头
 * 即树断口);纯静态标签,折叠由工作区卡片统一管辖。分组标识用通道缩写
 * (PTY / RPC),全称走悬浮提示。
 */

export function SectionLabel({ icon, text, count, title }: {
  icon: React.ReactNode;
  text: string;
  count?: number;
  /** 悬浮全称(PTY → 终端会话 / RPC → 带渲染的会话)。 */
  title?: string;
}) {
  return (
    <div className="ws-section-label" title={title}>
      {icon}
      <span className="ws-section-label-text">{text}</span>
      {count != null && <span className="pinned-sessions-header-count">· {count}</span>}
    </div>
  );
}
