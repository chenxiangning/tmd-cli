/**
 * 网络代理浮层(overlay 挂点渲染,portal 挂 body)—— 滑动块 + 代理地址。
 *
 * 入口:侧栏齿轮菜单/底栏钉住的「网络代理」按钮,经内核事件总线触发
 * (proxyPopoverStore);backdrop / Escape / 右上角 X 关闭。
 * 版式竖排(对齐 codemoss 参照):开关行 → 地址标签 → 整行输入框 → 提示;
 * 自带 pxy-* 排版类,不复用设置面板 pref-*(那是宽面板的横排度量,
 * 320px 浮层里会把文字列挤成窄条)。
 * 定位:渲染后实测尺寸再落位 —— 锚点右侧优先,放不下翻左侧;
 * 底部溢出视口则整体上移(实测替代估算,高度自适应不再被吃)。
 * 生效语义(应用在 Rust proxy.rs 的进程 env 注入):
 * 客户端联网请求与新建 CLI 会话立即走代理;已在跑的旧会话需手动重启。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { normalizeProxyUrl, proxyTransitionError, DEFAULT_PROXY_URL } from "./proxyCommit";
import { closeProxyPopover, useProxyPopoverState } from "./proxyPopoverStore";

/** 视口安全边距(px):四边留白,定位夹取用。 */
const VIEWPORT_MARGIN = 12;
/** 锚点到浮层的水平间距(px)。 */
const ANCHOR_GAP = 8;

export function ProxyPopover() {
  const { open, x, y } = useProxyPopoverState();
  const { settings } = useSettingsState();
  const { networkProxyEnabled: enabled, networkProxyUrl: persistedUrl } = settings;
  /* 打开即重挂载:预填已存地址,无则默认地址。 */
  const [draftUrl, setDraftUrl] = useState(() => persistedUrl || DEFAULT_PROXY_URL);
  const [error, setError] = useState<string | null>(null);
  /* 落位前的实测坐标;null = 尚未量好,先隐身防闪跳。 */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProxyPopover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* 实测定稿:offsetWidth/Height 已含换行后的真实高度,比估算可靠。 */
  useLayoutEffect(() => {
    if (!open) return;
    const el = popoverRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    /* 锚点(x,y)= 侧栏簇右缘上角:右侧优先,空间不足翻到锚点左侧。 */
    let left = x + ANCHOR_GAP;
    if (left + w > vw - VIEWPORT_MARGIN) {
      left = x - ANCHOR_GAP - w;
    }
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - w - VIEWPORT_MARGIN));
    /* 顶部对齐锚点;底部溢出则整体上移(浮窗高度自适应后仍可能高过视口,顶到 margin 为止)。 */
    let top = Math.min(y, vh - h - VIEWPORT_MARGIN);
    top = Math.max(VIEWPORT_MARGIN, top);
    setPos({ left, top });
  }, [open, x, y]);

  if (!open) return null;

  /** 校验 + 归一 + 提交;失败置 inline 错误并保持 store 不动。 */
  const commit = (nextEnabled: boolean, rawUrl: string): void => {
    const url = normalizeProxyUrl(rawUrl, nextEnabled);
    const message = proxyTransitionError(url);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    updateSettings({ networkProxyEnabled: nextEnabled, networkProxyUrl: url });
  };

  return createPortal(
    <>
      <div className="wsmenu-backdrop" onClick={closeProxyPopover} />
      <div
        ref={popoverRef}
        className="pxy-popover"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
        role="dialog"
        aria-label="网络代理"
        data-testid="network-proxy-popover"
      >
        <div className="pxy-head">
          <span className="pxy-title">网络代理</span>
          <button className="pxy-close" title="关闭" onClick={closeProxyPopover}>
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className="pxy-body">
          <div className="pxy-row">
            <div>
              <div className="pxy-label">启用网络代理</div>
              <div className="pxy-desc">客户端联网与新建 CLI 会话走该代理</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="启用网络代理"
              className={`pxy-switch${enabled ? " is-on" : ""}`}
              onClick={() => commit(!enabled, draftUrl)}
            >
              <span className="pxy-switch-thumb" />
            </button>
          </div>

          <label className="pxy-field" htmlFor="pxy-proxy-url">
            <span className="pxy-label">代理地址</span>
            <input
              id="pxy-proxy-url"
              value={draftUrl}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="代理地址"
              placeholder={DEFAULT_PROXY_URL}
              onChange={(e) => {
                setDraftUrl(e.target.value);
                setError(null);
              }}
              onBlur={() => commit(enabled, draftUrl)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(enabled, draftUrl);
              }}
              className="pxy-input"
            />
            {error && (
              <p role="alert" className="pxy-error" data-testid="proxy-url-error">
                {error}
              </p>
            )}
          </label>

          <p className="pxy-hint">
            支持 http(s) / socks5 / socks5h。开关即时生效;已在跑的旧会话需手动重启后走代理。
          </p>
        </div>
      </div>
    </>,
    document.body,
  );
}
