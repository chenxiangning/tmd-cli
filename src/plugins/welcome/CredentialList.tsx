/**
 * 引擎已登录供应商列表 —— welcome 页引擎卡下方的额度子区。
 *
 * 显示规则:
 * - 无任何凭据 → 不渲染(不显示"未登录"噪音,引擎卡本身已有安装状态);
 * - 有额度窗口 → 每窗口一行:label + 进度条 + 已用%;
 * - 余额型 → balanceText 一行;
 * - 查不到额度 → "已登录" + note 小字。
 */

import { useEffect, useState } from "react";
import { listEngineCredentials, type EngineCredential } from "./credentials";

export function CredentialList({ engineId }: { engineId: string }) {
  const [creds, setCreds] = useState<EngineCredential[] | null>(null);

  useEffect(() => {
    let alive = true;
    void listEngineCredentials(engineId).then((list) => {
      if (alive) setCreds(list);
    });
    return () => {
      alive = false;
    };
  }, [engineId]);

  if (!creds || creds.length === 0) return null;

  return (
    <div className="welcome-creds">
      {creds.map((cred) => (
        <div key={cred.providerId} className="welcome-cred">
          <div className="welcome-cred-head">
            <span className="welcome-cred-title">{cred.title}</span>
            {cred.planLabel && (
              <span className="welcome-cred-plan">{cred.planLabel}</span>
            )}
          </div>
          {cred.windows.length > 0 ? (
            <div className="welcome-cred-windows">
              {cred.windows.map((w) => (
                <div key={w.label} className="welcome-cred-window">
                  <span className="welcome-cred-window-label">{w.label}</span>
                  <span className="welcome-cred-window-bar">
                    <span
                      className="welcome-cred-window-fill"
                      style={{ width: `${Math.min(100, Math.max(0, w.displayPercent))}%` }}
                    />
                  </span>
                  <span className="welcome-cred-window-pct">
                    {Math.round(w.displayPercent)}%
                  </span>
                </div>
              ))}
            </div>
          ) : cred.balanceText ? (
            <div className="welcome-cred-balance">{cred.balanceText}</div>
          ) : (
            <div className="welcome-cred-note">
              {cred.note ?? "已登录"}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
