/**
 * RPC 幕布用户锚点栏 —— codemoss 刻度轨复刻(2026-11-06 spec):
 * 滚动容器左缘固定细轨,每个刻度 = 一条用户消息;点击 scrollTo 跳转,scroll
 * 监听把「最后一个 docTop ≤ scrollTop + 24px」的刻度置 active(高亮)。
 * 定位直测 DOM(data-vb = 块 id,SsUserBlock 自带),不经 kernel
 * messageAnchors 轮询 —— RPC 块全量在内存,DOM 即时准确,PTY 锚点体系零接触。
 * 刻度按 docTop/scrollHeight 比例分布进**垂直居中带状区**(带高 = 轨面 60%,
 * 2026-11-06 用户调整:居中不铺顶);密度超带高(条数 × 最小间距 > 带高)时
 * 回落纯比例,超密宁可重叠不压扁分布。刻度宽 6px(用户调整,原 12 减半),
 * hover 波浪式拉伸(CSS 弹性缓动 overshoot)并弹出信息小卡(data-label
 * CSS ::after 浮层,消息前 160 字)。
 * 有用户消息即渲染(单条也给锚点,跳回提问);刻度 label = 用户消息前 48 字
 * (内容自身即标签,零新增 i18n 键)。落定轮与活轮用户块同被收录。
 */
import { memo, useEffect, useRef, useState, type RefObject } from "react";

export interface SsAnchorUser {
  id: string;
  text: string;
}

const ACTIVE_LEAD_PX = 24;
const MIN_GAP_PX = 10;
/* 居中带状区:带高占轨面 60%(上下各留 20%),刻度分布其内。 */
const BAND_RATIO = 0.6;

/* docTop = 元素文档顶距(相对滚动容器内容原点);未挂载块返回 null。 */
function measureDocks(scrollEl: HTMLDivElement, users: SsAnchorUser[]): (number | null)[] {
  const origin = scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
  return users.map((u) => {
    const el = scrollEl.querySelector<HTMLElement>(`[data-vb="${CSS.escape(u.id)}"]`);
    return el ? el.getBoundingClientRect().top - origin : null;
  });
}

/* 刻度纵坐标(px,相对轨面):doc 比例映射进垂直居中带状区;密度允许时顺序
 * 推挤保最小间距,超带高回落纯比例。 */
function tickPixels(docks: (number | null)[], scrollH: number, faceH: number): (number | null)[] {
  const bandH = faceH * BAND_RATIO;
  const bandTop = (faceH - bandH) / 2;
  const raw = docks.map((d) => (d != null && scrollH > 0 ? bandTop + (d / scrollH) * bandH : null));
  if (raw.length * MIN_GAP_PX > bandH) return raw;
  let prev = bandTop - MIN_GAP_PX;
  return raw.map((p) => {
    if (p == null) return null;
    const q = Math.max(p, prev + MIN_GAP_PX);
    prev = q;
    return q;
  });
}

export const SsAnchorRail = memo(function SsAnchorRail({ scrollRef, users }: {
  scrollRef: RefObject<HTMLDivElement | null>;
  users: SsAnchorUser[];
}) {
  const [faceH, setFaceH] = useState(0);
  const [docks, setDocks] = useState<(number | null)[]>([]);
  const [active, setActive] = useState(0);
  const docksRef = useRef(docks);
  useEffect(() => {
    docksRef.current = docks;
  }, [docks]);

  /* 量轨:docTop + 轨面高;内容生长(scrollHeight 变化)/容器尺寸变化即重排,
   * 再延迟一拍校准字体/图片落定后的布局。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setFaceH(el.clientHeight);
      setDocks(measureDocks(el, users));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const timer = window.setTimeout(measure, 300);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [scrollRef, users]);

  /* active 跟随滚动:最后一个 docTop 越过视口顶 + 前置量的刻度。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const lead = el.scrollTop + ACTIVE_LEAD_PX;
      const ds = docksRef.current;
      let idx = 0;
      for (let i = 0; i < ds.length; i++) {
        if (ds[i] != null && (ds[i] as number) <= lead) idx = i;
      }
      setActive((v) => (v === idx ? v : idx));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  if (users.length === 0) return null;
  const scrollEl = scrollRef.current;
  const pixels = tickPixels(docks, scrollEl?.scrollHeight ?? 0, faceH);
  return (
    <div className="ss-anchorail">
      <div className="ss-anchorail-face" style={{ height: faceH }}>
        {users.map((u, i) => {
          const p = pixels[i];
          if (p == null) return null;
          const label = u.text.slice(0, 48) || "·";
          return (
            <button
              key={u.id}
              type="button"
              className={`ss-anchorail-tick${i === active ? " is-active" : ""}`}
              style={{ top: p }}
              data-label={u.text.slice(0, 160) || "·"}
              title={label}
              aria-label={label}
              onClick={() => {
                const d = docks[i];
                if (d != null) scrollEl?.scrollTo({ top: Math.max(d - 12, 0), behavior: "smooth" });
              }}
            />
          );
        })}
      </div>
    </div>
  );
});
