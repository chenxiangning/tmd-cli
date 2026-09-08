/**
 * 应用更新检查 —— GitHub Releases atom 通道 + CHANGELOG 解析(壳自有,非插件)。
 *
 * 设计决策:
 * - 检查:GET github.com/chenxiangning/tmd-cli/releases.atom,经 kernel 的
 *   quotaFetch 通用代理(Rust reqwest,text 模式直返原文)出网。不用
 *   api.github.com:匿名 60 次/小时/IP,共享出口 IP 下极易 403;atom 走
 *   github.com CDN 分发,无该限额,draft 不含(prerelease 会含)。
 * - 安装:打开 release 页交系统浏览器下载。产物未签名(CI 不引入
 *   TAURI_SIGNING_*),tauri-plugin-updater 不可用;补齐签名基础设施后
 *   只需替换本文件安装执行段,UI 不动(见 2026-09-06 design spec)。
 * - 更新记录:仓库根 CHANGELOG.md 经 Vite ?raw 打包内嵌,离线可看;
 *   版本小节与 Git tag / GitHub Releases 一一对应。
 * - 失败语义:绝不抛错;失败原因分级可展示(浏览器 dev / HTTP 状态 /
 *   网络不可达),调用方原样呈现,不冒充「网络不可用」。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import changelogRaw from "../../CHANGELOG.md?raw";

export const RELEASES_PAGE_URL = "https://github.com/chenxiangning/tmd-cli/releases";

/** releases.atom:首条 entry = 最新发布,机器生成、形状稳定。 */
const RELEASES_ATOM_URL = "https://github.com/chenxiangning/tmd-cli/releases.atom";

/** 检查结果:release 与 error 互斥(可判别联合,error 为可直接展示的人话原因)。 */
export type UpdateCheckResult =
  | { release: ReleaseInfo; error: null }
  | { release: null; error: string };

export interface ReleaseInfo {
  /** 不带 v 前缀的 semver。 */
  version: string;
  /** Release 标题(如 "tmd-cli v0.1.0")。 */
  name: string;
  /** Release 页地址(「前往下载」跳这里)。 */
  htmlUrl: string;
  /** ISO 8601 发布时间,缺失为空串。 */
  publishedAt: string;
  /** Release 说明原文(当前为 CI 通用文案,仅作预览展示)。 */
  notes: string;
}

/** 从 tag / 版本串抠严格 semver 三元组("v0.2.0" → "0.2.0");不合法/空 → null。 */
export function extractSemver(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null;
}

/** latest 是否比 current 更新(数值比较,0.10.0 > 0.9.0);任一不可解析 → false。 */
export function isNewerVersion(latest: string, current: string): boolean {
  const latestV = extractSemver(latest);
  const currentV = extractSemver(current);
  if (!latestV || !currentV) return false;
  const a = latestV.split(".").map(Number);
  const c = currentV.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== c[i]) return a[i] > c[i];
  }
  return false;
}

/** 从 atom 首条 entry 抠最新发布;形状由 GitHub 机器生成,正则解析足够。 */
export function parseAtomLatest(xml: string): ReleaseInfo | null {
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) return null;
  const tag = /<id>[^<]*\/([^<]+)<\/id>/.exec(entry)?.[1] ?? "";
  const version = extractSemver(tag);
  const htmlUrl = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(entry)?.[1];
  if (!version || !htmlUrl) return null;
  const title = (/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
  const updated = /<updated>([\s\S]*?)<\/updated>/.exec(entry)?.[1] ?? "";
  /* content 是 html 转义过的发布说明:解码实体 → 去标签 → 压空白,当纯文本预览。 */
  const notes = (/<content type="html">([\s\S]*?)<\/content>/.exec(entry)?.[1] ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { version, name: title || `v${version}`, htmlUrl, publishedAt: updated, notes };
}

/** 检查 GitHub 最新发布版;绝不抛错,失败原因分级在 error 里直接可展示。 */
export async function checkLatestRelease(): Promise<UpdateCheckResult> {
  /* 浏览器 dev(vite 直开)无 Tauri runtime,invoke 不存在 —— 单独提示,不冒充网络错误。 */
  if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
    return { release: null, error: t("当前为浏览器 dev 环境(无 Tauri runtime),无法发起检查;请在应用窗口内使用。") };
  }
  try {
    const res = await ipc.quotaFetch({ url: RELEASES_ATOM_URL, text: true });
    if (res.status !== 200) {
      return { release: null, error: t("更新源返回 HTTP {status},请稍后重试。", { status: res.status }) };
    }
    const release = parseAtomLatest(typeof res.body === "string" ? res.body : "");
    if (!release) {
      return { release: null, error: t("更新源响应格式异常,未解析到发布版本。") };
    }
    return { release, error: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      release: null,
      error: t("网络请求失败:{reason}。若网络需代理,请先在设置菜单「网络代理」中开启后重试。", { reason }),
    };
  }
}

/* ── CHANGELOG 解析 ──
 * Keep a Changelog 结构:## [x.y.z] - 日期 → ### 小节标题 → - 条目。
 * 只认这三层;其余行(导语、空行、底部链接引用)忽略。 */

export interface ChangelogBlock {
  heading: string;
  items: string[];
}

export interface ChangelogEntry {
  /** 方括号里的版本号原文(如 "0.1.0",Unreleased 原样保留)。 */
  version: string;
  /** 日期串(如 "2026-09-04"),缺失 null。 */
  date: string | null;
  blocks: ChangelogBlock[];
}

/** 逐行解析 CHANGELOG 原文,按书写顺序返回(最新在前)。 */
export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let block: ChangelogBlock | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const h2 = line.match(/^##\s+\[?([^\]\s]+)\]?(?:\s*-\s*(\S.+))?\s*$/);
    if (h2) {
      entry = { version: h2[1], date: h2[2]?.trim() || null, blocks: [] };
      block = null;
      entries.push(entry);
      continue;
    }
    if (!entry) continue;
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      block = { heading: h3[1], items: [] };
      entry.blocks.push(block);
      continue;
    }
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) {
      if (!block) {
        block = { heading: "", items: [] };
        entry.blocks.push(block);
      }
      block.items.push(item[1]);
    }
  }
  return entries;
}

/** 打包内嵌的更新记录(构建期固化,离线可读;模块加载时解析一次)。 */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = parseChangelog(changelogRaw);
