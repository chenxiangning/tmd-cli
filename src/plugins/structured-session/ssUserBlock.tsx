/**
 * RPC 用户块 —— 气泡卡片 + 图片单源内联(2026-11-05 二轮):
 * - 气泡:圆角描边卡(你 标签 + 文本 + 图片),替原 sv-user 蓝竖线形态;
 *   活轮/落定同形(SS 路径自渲染,不再内嵌 TranscriptBlockView 的 sv-user)。
 * - 图片单源律:引擎 message_end 权威块自带 images(base64,piTranscriptLine
 *   实证:{type:"image"} part / fileMention 行)时直接渲染引擎图,并把文本中的
 *   "@path" token 全部摘除;无 images 的块(omp follow_up 本地回显)走 token
 *   加载兜底(加载失败留 token)。双源并渲染 = 同图双行(2026-11-05 图证实锤)。
 * 仅 structured-session 消费,PTY 转录零接触。
 */
import { memo, useEffect, useState, type ComponentType } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { capped } from "@plugins/session-viewer/transcriptPhases";
import { Timestamp } from "@plugins/session-viewer/transcriptView";
import { imageTokens, imageSrcs, loadUserImage, stripLoaded } from "./ssUserBlockMeta";

/* 单图:点击缩放(sv-user-img 同律,ss 前缀独立样式)。 */
function SsUserImage({ src }: { src: string }) {
  const [zoom, setZoom] = useState(false);
  return (
    <button
      type="button"
      className={`ss-userblock-imgbtn${zoom ? " zoom" : ""}`}
      aria-label={t("切换图片大小")}
      onClick={() => setZoom((v) => !v)}
    >
      <img className="ss-userblock-img" src={src} alt="" />
    </button>
  );
}

export const SsUserBlock = memo(function SsUserBlock({ block, Markdown }: {
  block: CliTranscriptBlock;
  Markdown: ComponentType<{ children: string }>;
}) {
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const text = block.text ?? "";
  const engineImgs = block.images ?? [];
  /* 单源:引擎图在席 → token 路整体停用(不读盘);否则 token 加载兜底。 */
  const tokens = engineImgs.length ? [] : imageTokens(text);
  const tokenKey = tokens.join("\n");
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
  const shown = engineImgs.length
    ? stripLoaded(text, Object.fromEntries(imageTokens(text).map((p) => [p, ""])))
    : stripLoaded(text, loaded);
  const srcs = imageSrcs(block, loaded);
  return (
    /* data-vb = 块级深链锚点(查看转录定位 scrollIntoView 按它找人;
       RPC 会话树不消费,属性闲置无害)。 */
    <div className="ss-userblock" data-vb={block.id}>
      <div className="ss-userblock-head">
        <span className="ss-userblock-who">{t("你")}</span>
        <Timestamp ms={block.startedAt} />
      </div>
      {srcs.length ? (
        <div className="ss-userblock-imgs">
          {srcs.map((img) => (
            <SsUserImage key={img.key} src={img.src} />
          ))}
        </div>
      ) : null}
      {shown ? <Markdown>{capped(shown)}</Markdown> : null}
    </div>
  );
});
