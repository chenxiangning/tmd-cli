/**
 * RPC 用户块 —— 图片内联渲染(2026-11-05 幕布补全):粘贴/拖图经 composer
 * 附件机制落成临时文件 + "@path " token 进转录文本,幕布用户块原先只显示
 * 裸路径。本件在渲染层识别图片路径 token(纯函数/加载见 ssUserBlockMeta):
 * 加载成功即在用户位置内联渲染,并把对应 token 从展示文本中摘除;加载失败
 * 保留原 token。仅 structured-session 消费(user 块包装),PTY 转录零接触。
 */
import { memo, useEffect, useState, type ComponentType } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { TranscriptBlockView } from "@plugins/session-viewer/transcriptView";
import { imageTokens, loadUserImage, stripLoaded } from "./ssUserBlockMeta";

/* 单图:点击缩放(sv-user-img 同律,ss 前缀独立样式)。 */
function SsUserImage({ url }: { url: string }) {
  const [zoom, setZoom] = useState(false);
  return (
    <button
      type="button"
      className={`ss-userblock-imgbtn${zoom ? " zoom" : ""}`}
      aria-label={t("切换图片大小")}
      onClick={() => setZoom((v) => !v)}
    >
      <img className="ss-userblock-img" src={url} alt="" />
    </button>
  );
}

export const SsUserBlock = memo(function SsUserBlock({ block, Markdown }: {
  block: CliTranscriptBlock;
  Markdown: ComponentType<{ children: string }>;
}) {
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const text = block.text ?? "";
  const tokenKey = imageTokens(text).join("\n");
  useEffect(() => {
    if (!tokenKey) return;
    let alive = true;
    for (const p of tokenKey.split("\n")) {
      if (loaded[p]) continue;
      void loadUserImage(p).then((url) => {
        if (alive && url) setLoaded((s) => (s[p] ? s : { ...s, [p]: url }));
      });
    }
    return () => { alive = false; };
  }, [tokenKey, loaded]);
  const entries = Object.entries(loaded);
  const shown = stripLoaded(text, loaded);
  return (
    <div className="ss-userblock">
      {entries.length ? (
        <div className="ss-userblock-imgs">
          {entries.map(([p, url]) => (
            <SsUserImage key={p} url={url} />
          ))}
        </div>
      ) : null}
      <TranscriptBlockView
        block={shown === text ? block : { ...block, text: shown }}
        Markdown={Markdown}
      />
    </div>
  );
});
