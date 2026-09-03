/**
 * 章节大纲浮窗 —— 照抄 codemoss PreviewOutlineSidebar。
 *
 * 折叠态 = 右上角悬浮汉堡按钮;展开态 = 浮层面板(标题树 + 钉住按钮)。
 * 层级缩进 + 折叠 disclosure(+/-)+ 激活态高亮。
 * 与 codemoss 差异:i18n 文案硬编码中文。
 */

import { useCallback, useState } from "react";

/** 侧栏可渲染的最小条目形状。泛型化(纯类型改造):md 大纲与 PDF/文档
 *  预览大纲复用同一组件,target 类型由调用方自带,渲染只读 id/title/level/children。 */
type OutlineItemShape<T> = {
  id: string;
  title: string;
  level: number;
  children: T[];
};

function PreviewOutlineEntry<T extends OutlineItemShape<T>>({
  item,
  depth,
  activeItemId,
  onSelectItem,
  expandedItemIds,
  onToggleExpanded,
}: {
  item: T;
  depth: number;
  activeItemId: string | null;
  onSelectItem: (item: T) => void;
  expandedItemIds: Set<string>;
  onToggleExpanded: (itemId: string) => void;
}) {
  const isActive = activeItemId === item.id;
  const hasChildren = item.children.length > 0;
  const isExpanded = !hasChildren || expandedItemIds.has(item.id);

  return (
    <li className="fvp-preview-outline-entry">
      <div
        className="fvp-preview-outline-row"
        style={{ paddingInlineStart: `${Math.max(0, depth) * 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="fvp-preview-outline-disclosure"
            aria-label={isExpanded ? "折叠章节" : "展开章节"}
            aria-expanded={isExpanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(item.id);
            }}
          >
            {isExpanded ? "-" : "+"}
          </button>
        ) : (
          <span className="fvp-preview-outline-disclosure-spacer" />
        )}
        <button
          type="button"
          className={`fvp-preview-outline-button${isActive ? " is-active" : ""}`}
          aria-current={isActive ? "location" : undefined}
          onClick={() => onSelectItem(item)}
        >
          <span className="fvp-preview-outline-title">{item.title}</span>
          <span className="fvp-preview-outline-level">h{item.level}</span>
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <ul className="fvp-preview-outline-list">
          {item.children.map((childItem) => (
            <PreviewOutlineEntry
              key={childItem.id}
              item={childItem}
              depth={depth + 1}
              activeItemId={activeItemId}
              onSelectItem={onSelectItem}
              expandedItemIds={expandedItemIds}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function PreviewOutlineSidebar<T extends OutlineItemShape<T>>({
  items,
  activeItemId,
  onSelectItem,
  collapsed = false,
  pinned = true,
  onToggleCollapsed,
  onTogglePinned,
  onMouseLeave,
}: {
  items: T[];
  activeItemId: string | null;
  onSelectItem: (item: T) => void;
  collapsed?: boolean;
  pinned?: boolean;
  onToggleCollapsed?: () => void;
  onTogglePinned?: () => void;
  onMouseLeave?: () => void;
}) {
  const [collapsedItemIds, setCollapsedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expandableItemIds = collectExpandableItemIds(items);
  const expandedItemIds = new Set(
    expandableItemIds.filter((itemId) => !collapsedItemIds.has(itemId)),
  );
  const handleToggleExpanded = useCallback((itemId: string) => {
    setCollapsedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  if (collapsed) {
    return (
      <div className="fvp-preview-outline-float">
        <button
          type="button"
          className="fvp-preview-outline-float-button"
          aria-label="显示章节大纲"
          title="显示章节大纲"
          onClick={onToggleCollapsed}
        >
          <span className="fvp-preview-outline-menu-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
      </div>
    );
  }

  return (
    <nav className="fvp-preview-outline" aria-label="章节大纲" onMouseLeave={onMouseLeave}>
      <div className="fvp-preview-outline-panel">
        <header className="fvp-preview-section-header">
          <strong>章节</strong>
          <div className="fvp-preview-outline-actions">
            {onTogglePinned ? (
              <button
                type="button"
                className={`fvp-preview-outline-icon-button fvp-preview-outline-pin-button${pinned ? " is-active" : ""}`}
                aria-label={pinned ? "取消钉住大纲" : "钉住大纲"}
                title={pinned ? "取消钉住大纲" : "钉住大纲"}
                aria-pressed={pinned}
                onClick={onTogglePinned}
              >
                <svg
                  className="fvp-preview-outline-pin-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M14.5 3.5 20.5 9.5 17.5 10.4 14.2 13.7 14.7 18.2 13.4 19.5 10.1 16.2 5.8 20.5 4.5 19.2 8.8 14.9 5.5 11.6 6.8 10.3 11.3 10.8 14.6 7.5 14.5 3.5Z" />
                </svg>
              </button>
            ) : null}
          </div>
        </header>
        {items.length > 0 ? (
          <ul className="fvp-preview-outline-list">
            {items.map((item) => (
              <PreviewOutlineEntry<T>
                key={item.id}
                item={item}
                depth={0}
                activeItemId={activeItemId}
                onSelectItem={onSelectItem}
                expandedItemIds={expandedItemIds}
                onToggleExpanded={handleToggleExpanded}
              />
            ))}
          </ul>
        ) : (
          <div className="fvp-preview-outline-empty">无标题</div>
        )}
      </div>
    </nav>
  );
}

function collectExpandableItemIds<T extends OutlineItemShape<T>>(items: T[]): string[] {
  const itemIds: string[] = [];
  const visit = (item: T) => {
    if (item.children.length > 0) {
      itemIds.push(item.id);
    }
    item.children.forEach(visit);
  };
  items.forEach(visit);
  return itemIds;
}
