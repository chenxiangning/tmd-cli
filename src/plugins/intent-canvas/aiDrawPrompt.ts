/**
 * AI 作画提示词段(sendTransform 注入件,同步签名)。
 *
 * 目标:让会话里的 AI 不经截图、不经幕布,直接把结构化绘图文件写进 inbox,
 * 由画布插件轮询导入。指令含:inbox 绝对路径、JSON schema、目标画布提示、
 * 坐标系约定。文案与 aiDraw.ts 的解析规则配对,两边同步改。
 *
 * inbox 路径经 aiDrawPathCache 同步取(configHomeDir 是异步 IPC,发送路径上
 * 不允许 await;缓存由画布 tab 挂载/轮询时刷新,未缓存 = 无工作区在画布侧
 * 激活过,本轮不注入)。
 */

import { t } from "@kernel/i18n";
import type { IntentCanvasDocument } from "./types";

const pathCache: { value: { root: string; inbox: string } | null } = { value: null };

export function cacheAiDrawInboxPath(root: string, inbox: string): void {
  pathCache.value = { root, inbox };
}

export function aiDrawInboxPathSync(root: string): string | null {
  const cached = pathCache.value;
  return cached && cached.root === root ? cached.inbox : null;
}

export function buildAiDrawInstruction(
  inboxPath: string,
  activeDocument: IntentCanvasDocument | null,
): string {
  const target = activeDocument
    ? t("当前画布:{title}(id:{id})。默认把新图形追加到这张画布(mode 用 \"append\",并带 canvasId)。", {
        title: activeDocument.title,
        id: activeDocument.id,
      })
    : t("当前没有打开的画布。请新建一张(mode 用 \"new\",并自拟 title)。");
  return [
    "---",
    t("【意图画布 AI 作画】请在完成本任务的同时,把你要表达的结构/流程/模块关系画成一张图:"),
    t("1. 写一个 JSON 文件到:{path}(文件名必须是 ai-draw- 开头、.json 结尾)。", { path: inboxPath }),
    t("2. 文件格式:{\"kind\":\"intent-canvas-ai-draw\",\"version\":1,\"mode\":\"append\"|\"new\",\"canvasId\":\"可选\",\"title\":\"可选\",\"summary\":\"一句话意图\",\"shapes\":[…]}。"),
    t("3. shapes 每项:{\"type\":\"rectangle\"|\"ellipse\"|\"diamond\"|\"text\"|\"arrow\",\"x\":0,\"y\":0,\"width\":260,\"height\":92,\"label\":\"节点文字\",\"fontSize\":22,\"stroke\":\"#334155\",\"fill\":\"#eff6ff\"};箭头(type:\"arrow\")用 width/height 表达终点相对偏移。"),
    t("4. 坐标系向右向下增长;节点建议 260x92,列距约 340,行距约 132;先画主干再画分支,控制在 20 个图形以内。"),
    t("5. {target}", { target }),
    t("6. 只写这一个文件,不要改画布存储里的其他文件;写完文件即完成作画,客户端会自动把它画到画布上。"),
  ].join("\n");
}
