/**
 * 会话行内动作组 —— 齿轮入口 + 环形弹出组(portal+fixed,右半环);
 * PinToggle:独立置顶钮(置顶块行)。sessionViewOpener:查看深链装配(共用)。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@kernel/i18n";
import { PinIcon } from "@kernel/PinIcon";
import { EyeIcon, GearSixIcon, CopyIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";

/** 环半径(5 位 28px 按钮共存需 ≥40)与按钮尺寸(px)。 */
const RING_RADIUS = 44, ITEM_SIZE = 28;

/** 置顶按钮本体。 */
function PinButton({
  on,
  disabled,
  title,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={`thread-pin-btn${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={on ? t("取消置顶") : t("置顶到全局")}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <PinIcon size="0.75rem" className="thread-pin-icon" />
    </button>
  );
}

/** 行内扎点开关(独立场景:置顶块行)—— hover 显形 / 已扎常亮。 */
export function PinToggle({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <PinButton
      on={on}
      disabled={disabled}
      title={
        disabled
          ? t("会话尚未落盘,暂不可置顶")
          : on
            ? t("取消置顶")
            : t("置顶到全局(右键可置顶到工作区内)")
      }
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    />
  );
}

/** 环形动作组的单个操作位(fixed 环坐标系内,px 定位)。 */
function RadialAction({
  angle,
  order,
  label,
  danger,
  armed,
  icon,
  onClick,
}: {
  angle: number;
  order: number;
  label: string;
  danger?: boolean;
  armed?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) * RING_RADIUS - ITEM_SIZE / 2;
  const dy = Math.sin(rad) * RING_RADIUS - ITEM_SIZE / 2;
  return (
    <button
      type="button"
      className={`sv-radial-item${danger ? " is-danger" : ""}${armed ? " is-armed" : ""}`}
      style={{
        /* transform 必须直写解析值,严禁走 --dx/--dy 自定义属性:
           var() 参与 transform 时 WKWebView/Chromium 的真实指针 hit-test
            解析不了该值,命中区滞留环心,点击穿透(WKWebView/Chromium 双引擎实证;
           elementFromPoint 走主线程探不出此 bug)。 */
        transform: `translate(${dx}px, ${dy}px)`,
        animationDelay: `${order * 30}ms`,
      }}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </button>
  );
}

/**
 * 行尾齿轮动作组:环 portal 到 body(fixed 定位齿轮屏幕坐标),右半环展开。
 */
export function ThreadRowActions({
  pinned,
  disabled,
  onTogglePin,
  onOpenView,
  onCopyId,
  onRename,
  onDelete,
}: {
  pinned: boolean;
  /** 会话尚未落盘时不可扎(覆盖层以 CLI 身份为 key)。 */
  disabled?: boolean;
  onTogglePin: () => void;
  /** 查看回调;undefined = 该行无查看能力(环里不出查看位)。 */
  onOpenView?: () => void;
  onCopyId?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  /* 环心屏幕坐标(展开时取齿轮 rect;渲染后随窗口滚动/resize 失准可接受——
     环是短命浮层,标准菜单类生命周期)。 */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const gearRef = useRef<HTMLButtonElement | null>(null);

  /* 开:取齿轮屏幕坐标(layout 期同步设,首帧即出环);关:清空坐标与武装态。 */
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      setArmed(false);
      return;
    }
    const rect = gearRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  }, [open]);


  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  /* 环位装配:查看/置顶常驻;复制/重命名/删除按传入出现。右半环 -90°→90°
   * 自上而下,删除放最下(危险项离齿轮最远)。 */
  const close = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  type Action = { key: string; label: string; icon: React.ReactNode; danger?: boolean; onClick: () => void };
  const actions: Action[] = [
    ...(onOpenView
      ? [{
          key: "view",
          label: t("查看会话转录(只读)"),
          icon: <EyeIcon size="0.9375rem" />,
          onClick: close(onOpenView),
        }]
      : []),
    {
      key: "pin",
      label: pinned ? t("取消置顶") : t("置顶到全局"),
      icon: <PinIcon size="0.9375rem" className="thread-pin-icon" />,
      onClick: () => {
        if (disabled) return;
        close(onTogglePin)();
      },
    },
    ...(onCopyId
      ? [{
          key: "copy",
          label: t("复制 Session ID"),
          icon: <CopyIcon size="0.9375rem" />,
          onClick: close(onCopyId),
        }]
      : []),
    ...(onRename
      ? [{
          key: "rename",
          label: t("重命名"),
          icon: <PencilSimpleIcon size="0.9375rem" />,
          onClick: close(onRename),
        }]
      : []),
    ...(onDelete
      ? [{
          key: "delete",
          label: armed ? t("再点一次确认删除") : t("删除会话"),
          danger: true,
          icon: <TrashIcon size="0.9375rem" />,
          onClick: () => {
            if (!armed) {
              setArmed(true);
              return;
            }
            close(onDelete)();
            setArmed(false);
          },
        }]
      : []),
  ];

  return (
    <span className={`thread-actions${open ? " open" : ""}${pinned ? " is-pinned" : ""}`}>
      {open && anchor
        ? createPortal(
            <>
              {/* 透明背板:点外关闭(wsmenu 同款;hover 收起会误杀移向环位的鼠标)。 */}
              <div
                className="sv-radial-backdrop" role="presentation"
                onClick={() => setOpen(false)}
                onContextMenu={(e) => (e.preventDefault(), setOpen(false))}
              />
              <div
                className="sv-radial"
                role="group"
                aria-label={t("会话操作")}
                style={{ left: anchor.x, top: anchor.y }}
              >
                {actions.map((action, index) => {
                  const angle =
                    actions.length === 1 ? 0 : -90 + (180 / (actions.length - 1)) * index;
                  return (
                    <RadialAction
                      key={action.key}
                      angle={angle}
                      order={index}
                      label={action.label}
                      danger={action.danger}
                      armed={armed && action.key === "delete"}
                      icon={action.icon}
                      onClick={action.onClick}
                    />
                  );
                })}
              </div>
            </>,
            document.body,
          )
        : null}
      <button
        ref={gearRef}
        type="button"
        className={`thread-gear-btn${pinned ? " is-on" : ""}`}
        aria-expanded={open}
        aria-label={t("会话操作")}
        title={t("会话操作")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <GearSixIcon size="0.8125rem" />
      </button>
    </span>
  );
}
