/**
 * DshConnectionSettings —— 首页 dsh 面板的「连接设置」折叠区(codemoss 同构):
 * 折叠头带摘要(host:port · 自动启动开/关),展开为自定义路径 / Host 地址 /
 * 自动启动主机三行。改动即保存并触发 onChange(面板据此重测);拨自动启动
 * 开关不会立刻启停 host(codemoss 口径)。
 */

import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { normalizeConnection, type DshConnection } from "./dshHost";

const INPUT =
  "rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-sm text-(--tmd-fg) outline-none focus:border-(--tmd-accent)";

export function DshConnectionSettings({
  conn,
  onChange,
}: {
  conn: DshConnection;
  /** 任一行提交(失焦/拨开关)后回调,参数为已持久化的新配置。 */
  onChange: (next: DshConnection) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = `${conn.host}:${conn.port} · 自动启动${conn.autoStart ? "开" : "关"}`;

  const apply = (patch: Partial<DshConnection>) => {
    onChange({ ...conn, ...patch });
  };

  return (
    <div className="pref-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 bg-transparent p-0 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="pref-title">连接设置</span>
        <span className="text-xs text-(--tmd-fg-muted)">{summary}</span>
        <CaretDown
          size={13}
          className={`ml-auto shrink-0 transition-transform${open ? " rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="pref-row">
            <div>
              <div className="pref-title">自定义 DeepSeek Harness 路径</div>
              <div className="pref-desc">
                留空用 PATH 里的 dsh;改动即保存,下次启动服务生效。
              </div>
            </div>
            <input
              aria-label="自定义 DeepSeek Harness 路径"
              className={`${INPUT} w-64 text-left`}
              defaultValue={conn.customBin}
              placeholder="/usr/local/bin/dsh"
              onBlur={(e) => apply({ customBin: e.target.value.trim() })}
            />
          </div>
          <div className="pref-row">
            <div>
              <div className="pref-title">Host 地址</div>
              <div className="pref-desc">默认本机。改端口前先确认没有别的进程占着。</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                aria-label="Host 地址"
                className={`${INPUT} w-40 text-left`}
                defaultValue={conn.host}
                onBlur={(e) => onChange(normalizeConnection(e.target.value, String(conn.port), conn))}
              />
              <input
                aria-label="端口"
                className={`${INPUT} w-24 text-right`}
                type="number"
                min={1}
                max={65535}
                defaultValue={conn.port}
                onBlur={(e) => onChange(normalizeConnection(conn.host, e.target.value, conn))}
              />
            </div>
          </div>
          <div className="pref-row">
            <div>
              <div className="pref-title">自动启动主机</div>
              <div className="pref-desc">
                下次进首页且 host 未运行时自动拉起。拨开关不会立刻启动或停止。
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={conn.autoStart}
              aria-label="自动启动主机"
              className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors${
                conn.autoStart
                  ? " border-(--tmd-accent) bg-(--tmd-accent)"
                  : " border-(--tmd-border) bg-(--tmd-bg-input)"
              }`}
              onClick={() => apply({ autoStart: !conn.autoStart })}
            >
              <span
                className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all${
                  conn.autoStart ? " left-[18px]" : " left-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
