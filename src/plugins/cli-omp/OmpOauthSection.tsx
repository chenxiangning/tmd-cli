/**
 * omp 供应商认证 · 订阅授权段 —— OAuth 状态行(只读)+ 登录按钮。
 * 登录 = 开内置终端会话打入 `omp auth-broker login <arg>`(PTY Enter = CR)。
 */


export { OMP_OAUTH_PROVIDERS, launchLogin, type OmpOauthProvider } from "./providerAuthCatalog";

/** 行首字母头像(tmd 无品牌 svg 资产;配色按 id 哈希取固定色板)。 */
const AVATAR_HUES = [4, 25, 42, 95, 145, 170, 200, 225, 255, 280, 310, 335];
export function BrandAvatar({ id, name, icon }: { id: string; name: string; icon?: string | null }) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  if (icon)
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--tmd-bg-popover)" aria-hidden>
        <img src={icon} alt="" className="size-4" />
      </span>
    );
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold"
      style={{ background: `oklch(0.9 0.06 ${hue})`, color: `oklch(0.45 0.15 ${hue})` }}
      aria-hidden
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function StatusDot({ on }: { on: boolean }) {
  return <span className={`size-1.5 rounded-full ${on ? "bg-(--tmd-ok)" : "bg-(--tmd-fg-muted)"}`} aria-hidden />;
}
