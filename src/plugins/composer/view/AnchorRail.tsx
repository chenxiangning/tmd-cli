/**
 * 消息锚点栏 —— composer 右缘的用户消息导航(参照 codemoss MessagesAnchorRail)。
 *
 * - dash 均匀堆叠:每条用户消息一格,不代表幕布真实行位置(幕布是字节流,行位置不可靠);
 *   超出可视高度时按 codemoss 分桶算法抽样,active 所在桶强制取 active。
 * - 命中区跟手:dash 按钮铺满整行(26×10),视觉短线是 ::before 伪元素;
 *   hover 时邻近 dash 按距离渐变加宽(is-proximity-0..3,codemoss 同款)。
 * - hover dash → portal 预览卡(序号 + 首行 60 字 + 余文 160 字),fixed 定位浮出 composer。
 * - 点击 → jumpToAnchor:xterm buffer 定位 + ease-out 平滑滚动,28% 留头;失败短暂闪烁。
 * - active 追踪:rAF 逐帧(不防抖,滚动即跟),参考线向上找最近锚点行。
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { host, useHost } from "@kernel/host";
import {
  getTerminalHandle,
  jumpToAnchor,
  messageAnchors,
  resolveActiveAnchorId,
  subscribeTerminalRegistry,
  terminalRegistryVersion,
  type UserMessageAnchor,
} from "@kernel/messageAnchors";

/** dash 行高(视觉线 2px + 命中区 10px + 间隙 3px),可视容量 = 栏高 / ROW_PX。 */
const ROW_PX = 13;
const PREVIEW_TITLE_CHARS = 60;
const PREVIEW_DESC_CHARS = 160;
const MISS_FLASH_MS = 1200;
/** 邻近渐变的最大距离:is-proximity-0..3。 */
const PROXIMITY_RANGE = 3;

interface VisibleAnchor {
  anchor: UserMessageAnchor;
  /** 在完整列表里的序号(预览卡 N. 标题来源)。 */
  index: number;
}

/**
 * 分桶抽样(纯函数,可测):锚点数超容量时均分 maxVisible 桶,每桶取中点;
 * active 落在哪个桶,该桶就强制显示 active(codemoss 同款算法)。
 */
export function sampleAnchors(
  anchors: readonly UserMessageAnchor[],
  maxVisible: number,
  activeId: string | null,
): VisibleAnchor[] {
  if (anchors.length <= maxVisible) {
    return anchors.map((anchor, index) => ({ anchor, index }));
  }
  const activeIndex = activeId ? anchors.findIndex((a) => a.id === activeId) : -1;
  return Array.from({ length: maxVisible }, (_, bucket) => {
    const start = Math.floor((bucket * anchors.length) / maxVisible);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * anchors.length) / maxVisible));
    const pick =
      activeIndex >= start && activeIndex < end ? activeIndex : Math.floor((start + end - 1) / 2);
    return { anchor: anchors[pick]!, index: pick };
  });
}

/** 预览卡文案(codemoss deriveAnchorPreviewCopy 规则):首行截 60 字做标题,余行合并截 160 字。 */
function previewCopy(text: string): { title: string; desc: string } {
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    title: (lines[0] ?? "").slice(0, PREVIEW_TITLE_CHARS),
    desc: lines.slice(1).join(" ").slice(0, PREVIEW_DESC_CHARS),
  };
}

interface PreviewState {
  anchor: UserMessageAnchor;
  index: number;
  /** dash 的视口坐标,portal 卡片定位用。 */
  rect: DOMRect;
}

/** portal 预览卡:默认垂直居中于 dash,出视口则收敛回视口内。 */
function AnchorPreviewCard({ preview }: { preview: PreviewState }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(preview.rect.top + preview.rect.height / 2);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const half = card.offsetHeight / 2;
    const ideal = preview.rect.top + preview.rect.height / 2;
    setTop(Math.min(Math.max(ideal, half + 8), window.innerHeight - half - 8));
  }, [preview]);
  const { title, desc } = previewCopy(preview.anchor.text);
  return createPortal(
    <div
      ref={cardRef}
      className="composer-anchor-preview"
      style={{ top, right: window.innerWidth - preview.rect.left + 10 }}
      role="tooltip"
      data-testid="composer-anchor-preview"
    >
      <strong className="composer-anchor-preview-title">
        {preview.index + 1}. {title}
      </strong>
      {desc && <span className="composer-anchor-preview-desc">{desc}</span>}
    </div>,
    document.body,
  );
}

export function AnchorRail() {
  useHost();
  const sessionId = host.getActiveSessionId();
  const anchors = useSyncExternalStore(messageAnchors.subscribe, () =>
    messageAnchors.getAnchors(sessionId),
  );
  /* TerminalView 按 session key 重挂载,注册表版本驱动重取 handle */
  const registryTick = useSyncExternalStore(subscribeTerminalRegistry, terminalRegistryVersion);

  const railRef = useRef<HTMLDivElement>(null);
  const [maxVisible, setMaxVisible] = useState(32);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [missId, setMissId] = useState<string | null>(null);

  /* composer 高度可拖:栏容量随实际高度收敛 */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new ResizeObserver(() => {
      setMaxVisible(Math.max(1, Math.floor(rail.clientHeight / ROW_PX)));
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  const visible = sampleAnchors(anchors, maxVisible, activeId);

  /* 滚动 active 追踪:rAF 逐帧,滚动即跟;锚点刷新/会话切换/幕布重挂载时立即重解 */
  useEffect(() => {
    setActiveId(null);
    if (!sessionId || anchors.length === 0) return;
    const handle = getTerminalHandle(sessionId);
    if (!handle) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const id = resolveActiveAnchorId(handle, anchors);
      if (id) setActiveId(id);
    };
    const off = handle.onScroll(() => {
      if (raf === 0) raf = requestAnimationFrame(update);
    });
    update();
    return () => {
      off();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [sessionId, anchors, registryTick]);

  if (!sessionId || anchors.length === 0) return null;

  const handleJump = (anchor: UserMessageAnchor) => {
    setPreview(null);
    setHoverIndex(null);
    setActiveId(anchor.id);
    void jumpToAnchor(sessionId, anchor).then((ok) => {
      if (ok) return;
      setMissId(anchor.id);
      window.setTimeout(() => setMissId((cur) => (cur === anchor.id ? null : cur)), MISS_FLASH_MS);
    });
  };

  return (
    <div
      ref={railRef}
      className="composer-anchor-rail"
      role="navigation"
      aria-label="消息锚点"
      onMouseLeave={() => {
        setPreview(null);
        setHoverIndex(null);
      }}
    >
      {visible.map(({ anchor, index }, visibleIndex) => {
        const distance = hoverIndex === null ? -1 : Math.abs(visibleIndex - hoverIndex);
        const proximity =
          distance >= 0 && distance <= PROXIMITY_RANGE ? ` is-proximity-${distance}` : "";
        return (
          <div key={anchor.id} className={`composer-anchor-item${proximity}`}>
            <button
              type="button"
              className={`composer-anchor-dash${activeId === anchor.id ? " is-active" : ""}${missId === anchor.id ? " is-miss" : ""}`}
              aria-label={`${index + 1}. ${previewCopy(anchor.text).title}`}
              aria-current={activeId === anchor.id ? "location" : undefined}
              onMouseEnter={(e) => {
                setHoverIndex(visibleIndex);
                setPreview({ anchor, index, rect: e.currentTarget.getBoundingClientRect() });
              }}
              onFocus={(e) => {
                setHoverIndex(visibleIndex);
                setPreview({ anchor, index, rect: e.currentTarget.getBoundingClientRect() });
              }}
              onBlur={() => {
                setPreview(null);
                setHoverIndex(null);
              }}
              onClick={() => handleJump(anchor)}
              data-testid="composer-anchor-dash"
            />
          </div>
        );
      })}
      {preview && <AnchorPreviewCard preview={preview} />}
    </div>
  );
}
