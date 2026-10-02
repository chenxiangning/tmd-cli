/**
 * AI 作画提示词段(sendTransform 注入件,同步签名)。
 *
 * 目标:让会话里的 AI 不经截图、不经幕布,直接把结构化绘图文件写进 inbox,
 * 由画布插件轮询导入。指令含:inbox 绝对路径、JSON schema、目标画布提示、
 * 坐标系约定。文案与 aiDraw.ts 的解析规则配对,两边同步改。
 *
 * 作画目标缺省序:编辑器开着的当前文档 → 最近更新画布(索引倒序首位,
 * 存储层读后经 cacheAiDrawLatestCanvas 自喂)→ 都没有才让 AI 新建
 * (2026-10 审计:防结果散落多张新画布)。
 *
 * inbox 路径经 aiDrawPathCache 同步取(configHomeDir 是异步 IPC,发送路径上
 * 不允许 await;缓存由 activate 级轮询/开关预热时刷新,未缓存 = 本轮不注入)。
 */

import { t } from "@kernel/i18n";
import type { IntentCanvasDocument } from "./types";

const pathCache: { value: { root: string; inbox: string } | null } = { value: null };
const latestCache: { value: { root: string; id: string; title: string } | null } = { value: null };

export function cacheAiDrawInboxPath(root: string, inbox: string): void {
  pathCache.value = { root, inbox };
}

export function aiDrawInboxPathSync(root: string): string | null {
  const cached = pathCache.value;
  return cached && cached.root === root ? cached.inbox : null;
}

/** 最近更新画布缓存喂入(storage 层读索引后调用;null = 该工作区已无画布)。 */
export function cacheAiDrawLatestCanvas(root: string, latest: { id: string; title: string } | null): void {
  latestCache.value = latest ? { root, ...latest } : { root, id: "", title: "" };
}

export function aiDrawLatestCanvasSync(root: string): { id: string; title: string } | null {
  const cached = latestCache.value;
  return cached && cached.root === root && cached.id ? { id: cached.id, title: cached.title } : null;
}

export function buildAiDrawInstruction(
  inboxPath: string,
  activeDocument: IntentCanvasDocument | null,
  latestCanvas: { id: string; title: string } | null = null,
): string {
  const target = activeDocument
    ? t("当前画布:{title}(id:{id})。默认把新图形追加到这张画布(mode 用 \"append\",并带 canvasId)。", {
        title: activeDocument.title,
        id: activeDocument.id,
      })
    : latestCanvas
      ? t("最近画布:{title}(id:{id})。默认把新图形追加到这张画布(mode 用 \"append\",并带 canvasId)。", {
          title: latestCanvas.title,
          id: latestCanvas.id,
        })
      : t("当前没有打开的画布。请新建一张(mode 用 \"new\",并自拟 title)。");
  return [
    "---",
    t("【意图画布 AI 作画】请在完成本任务的同时,把你要表达的结构/流程/模块关系画成一张图:"),
    t("1. 写一个 JSON 文件到:{path}(文件名必须是 ai-draw- 开头、.json 结尾;全文不超过 512KB)。", { path: inboxPath }),
    t("2. 文件格式:{\"kind\":\"intent-canvas-ai-draw\",\"version\":1,\"mode\":\"append\"|\"new\",\"canvasId\":\"可选\",\"title\":\"可选\",\"summary\":\"一句话意图\",\"shapes\":[…]}。"),
    t("3. shapes 每项:{\"type\":\"rectangle\"|\"ellipse\"|\"diamond\"|\"text\"|\"arrow\",\"x\":0,\"y\":0,\"width\":260,\"height\":92,\"label\":\"节点标题(每个节点形状必填)\",\"fontSize\":20,};颜色由客户端统一配色(勿传 stroke/fill,传了也会被忽略);箭头(type:\"arrow\")用 width/height 表达终点相对偏移。"),
    t("4. 布局自上而下分层:第一层在最上方,同层节点横向排(列距约 340),下一层整体下移(层距约 160);箭头从上层节点连向下层节点;先画主干再画分支,控制在 20 个图形以内,每个形状的 label 写清节点标题。"),
    t("5. {target}", { target }),
    t("6. 只写这一个文件,不要改画布存储里的其他文件;写完文件即完成作画,客户端会自动把它画到画布上。"),
  ].join("\n");
}
