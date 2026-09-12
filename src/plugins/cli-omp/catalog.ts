/**
 * omp 扩展目录与数据解析 —— cli-omp 私有语义,market.tsx 的数据侧。
 *
 * 目录(热门列表):npm registry 搜索 API 双关键词并发(omp-plugin 专属 +
 * pi-package 兼容;omp 消费 pi manifest,生态大量共用),按周下载量排序;
 * 失败回落内置静态精选表(离线模式,顶部黄条提示),静态表兼任缺失描述补全源。
 * 已装清单:`omp plugin list --json` 的 .npm[] 防御性解析。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";

export interface ExtCatalogEntry {
  name: string;
  /** 最新版本;离线静态表无版本。 */
  version?: string;
  description: string;
  /** 周下载量;0 = 未知(离线表),UI 不展示。 */
  weeklyDownloads: number;
  homepage: string | null;
  /** 静态精选条目(人工审校描述);实时条目无此标记。 */
  curated?: boolean;
}

/** 已装扩展(omp plugin list .npm[] 行的投影)。 */
export interface InstalledExt {
  name: string;
  version: string;
  enabled: boolean;
}

/** 目录容量:热门取前 N。 */
const CATALOG_CAP = 20;

/** 目录内存缓存;面板重复开合不重拉,force 强刷。 */
const CACHE_MS = 20_000;
let cache: { at: number; catalog: ExtCatalog } | null = null;

export interface ExtCatalog {
  entries: ExtCatalogEntry[];
  /** true = 实时拉取失败,当前展示静态精选表。 */
  offline: boolean;
}

/** npm 搜索:omp 专属 + pi 兼容双关键词(各 25 条,合并去重后取前 20)。 */
const SEARCH_URLS = [
  "https://registry.npmjs.org/-/v1/search?text=keywords:omp-plugin&size=25",
  "https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=25",
];

/**
 * 静态精选表 —— 实时目录的离线兜底 + 描述补全源(人工审校中文描述)。
 * 版本/下载量留空(offline 语义),条目均为 npm 在售的真实包(2026-09-06 核对)。
 */
const CURATED_CATALOG: ExtCatalogEntry[] = [
  {
    name: "@cortexkit/pi-magic-context",
    description: "Magic Context 共享记忆库:跨 CLI 持久记忆与会话检索",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/@cortexkit/pi-magic-context",
    curated: true,
  },
  {
    name: "@juicesharp/rpiv-todo",
    description: "模型自维护的 TODO 清单,浮层常驻、压缩后不丢",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/@juicesharp/rpiv-todo",
    curated: true,
  },
  {
    name: "@juicesharp/rpiv-ask-user-question",
    description: "模型向你发起结构化问卷(带类型选项),替代凭空猜测",
    weeklyDownloads: 0,
    homepage:
      "https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question",
    curated: true,
  },
  {
    name: "pi-background-tasks",
    description: "持久后台 shell 任务与只读委派代理",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-background-tasks",
    curated: true,
  },
  {
    name: "pi-lens",
    description: "实时代码反馈:LSP / lint / 类型检查 / 结构分析",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-lens",
    curated: true,
  },
  {
    name: "pi-subagents",
    description: "单代理委派与脚本化多代理工作流",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-subagents",
    curated: true,
  },
  {
    name: "pi-web-access",
    description: "网络搜索 / URL 抓取 / GitHub 克隆 / PDF 与视频理解",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-web-access",
    curated: true,
  },
  {
    name: "pi-mcp-adapter",
    description: "MCP(Model Context Protocol)服务器接入适配",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-mcp-adapter",
    curated: true,
  },
  {
    name: "omp-kiro",
    description: "Kiro OAuth 登录、额度用量与模型发现",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/omp-kiro",
    curated: true,
  },
  {
    name: "omp-plugin-duplicate-detector",
    description: "基于 jscpd 的重复代码检测插件",
    weeklyDownloads: 0,
    homepage:
      "https://www.npmjs.com/package/omp-plugin-duplicate-detector",
    curated: true,
  },
];

/** 官方包排除:@oh-my-pi/* 是引擎本体,不是插件。 */
function isExcluded(name: string): boolean {
  return name.startsWith("@oh-my-pi/");
}

interface NpmSearchHit {
  package?: {
    name?: unknown;
    version?: unknown;
    description?: unknown;
    links?: { homepage?: unknown; npm?: unknown };
  };
  downloads?: { weekly?: unknown };
}

/** npm 搜索响应 → 目录条目(字段全防御,缺描述回空串由静态表补)。 */
export function parseNpmSearch(body: unknown): ExtCatalogEntry[] {
  const objects = (body as { objects?: unknown } | null)?.objects;
  if (!Array.isArray(objects)) return [];
  const entries: ExtCatalogEntry[] = [];
  for (const raw of objects) {
    const hit = raw as NpmSearchHit;
    const pkg = hit.package;
    const name = typeof pkg?.name === "string" ? pkg.name : "";
    if (!name) continue;
    const links = pkg?.links;
    const homepage =
      typeof links?.homepage === "string"
        ? links.homepage
        : typeof links?.npm === "string"
          ? links.npm
          : null;
    entries.push({
      name,
      version: typeof pkg?.version === "string" ? pkg.version : undefined,
      description: typeof pkg?.description === "string" ? pkg.description : "",
      weeklyDownloads:
        typeof hit.downloads?.weekly === "number" ? hit.downloads.weekly : 0,
      homepage,
    });
  }
  return entries;
}

/**
 * 多来源合并:按包名去重(先到者优先,后续来源只补描述/主页缺口),
 * 排除官方包,周下载量降序取前 CAP。静态表作为末位来源传入即实现
 * 「兜底 + 补全」双语义。
 */
export function mergeCatalog(
  lists: ExtCatalogEntry[][],
  cap = CATALOG_CAP,
): ExtCatalogEntry[] {
  const byName = new Map<string, ExtCatalogEntry>();
  for (const list of lists) {
    for (const entry of list) {
      if (isExcluded(entry.name)) continue;
      const existing = byName.get(entry.name);
      if (!existing) {
        byName.set(entry.name, { ...entry });
        continue;
      }
      if (!existing.description && entry.description)
        existing.description = entry.description;
      if (existing.homepage === null && entry.homepage)
        existing.homepage = entry.homepage;
    }
  }
  return [...byName.values()]
    .sort((a, b) => b.weeklyDownloads - a.weeklyDownloads)
    .slice(0, cap);
}

/** 拉取目录(20s 缓存;force 强刷)。双关键词全败 → 静态精选表 + offline 标记。 */

/* 强刷竞态守卫:force 与首发并发在飞时,只有最后一次发起的结果允许落缓存/
 * 返回调用方,防旧响应后到覆盖新目录。 */
let fetchSeq = 0;

export async function fetchExtCatalog(force = false): Promise<ExtCatalog> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.catalog;
  const seq = ++fetchSeq;
  const settled = await Promise.allSettled(
    SEARCH_URLS.map(async (url) => {
      const res = await ipc.quotaFetch({ url });
      return parseNpmSearch(res.body);
    }),
  );
  if (seq !== fetchSeq) {
    /* 已被更强刷的发起接手:本次作废,返回当前已知缓存(新请求完成后
     * 自会刷新调用方状态),绝不重入再发请求。 */
    return cache?.catalog ?? { entries: CURATED_CATALOG, offline: true };
  }
  const ok = settled
    .filter((r): r is PromiseFulfilledResult<ExtCatalogEntry[]> => r.status === "fulfilled")
    .map((r) => r.value);
  const catalog: ExtCatalog =
    ok.length > 0
      ? { entries: mergeCatalog([...ok, CURATED_CATALOG]), offline: false }
      : { entries: CURATED_CATALOG, offline: true };
  cache = { at: Date.now(), catalog };
  return catalog;
}

/**
 * `omp plugin list --json` 解析:取 .npm[](marketplace 通道一期不做)。
 * 形状不符(未来格式漂移)抛错,调用方显式「无法解析」,不做猜测兜底。
 */
export function parseOmpPluginList(body: unknown): InstalledExt[] {
  const npm = (body as { npm?: unknown } | null)?.npm;
  if (!Array.isArray(npm)) throw new Error(t("omp plugin list 缺少 npm 数组"));
  const out: InstalledExt[] = [];
  for (const raw of npm) {
    const rec = raw as {
      name?: unknown;
      version?: unknown;
      manifest?: { version?: unknown };
      enabled?: unknown;
    };
    const name = typeof rec.name === "string" ? rec.name : "";
    if (!name) continue;
    const version =
      typeof rec.version === "string"
        ? rec.version
        : typeof rec.manifest?.version === "string"
          ? rec.manifest.version
          : "";
    out.push({ name, version, enabled: rec.enabled === true });
  }
  return out;
}

/* ── 已装描述兜底 ──
 * 目录(双关键词 top20 + 精选表)覆盖不到的已装包,展开详情时按包名
 * 拉 registry 单包文档补描述。corgi(abbr) Accept 裁掉全量 versions 载荷。 */

/** 单包描述缓存:成功与失败都记(失败记空串,防反复打)。 */
const descCache = new Map<string, string>();

/** 拉单包描述;失败回空串(UI 显「暂无描述」)。 */
export async function fetchPkgDescription(name: string): Promise<string> {
  const cached = descCache.get(name);
  if (cached !== undefined) return cached;
  try {
    /* scoped 包:@scope%2Fname(首段 @ 保留,斜杠转义)。 */
    const encoded = encodeURIComponent(name).replace(/^%40/, "@");
    const res = await ipc.quotaFetch({
      url: `https://registry.npmjs.org/${encoded}`,
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    });
    const body = res.body as { description?: unknown } | null;
    const desc = typeof body?.description === "string" ? body.description : "";
    descCache.set(name, desc);
    return desc;
  } catch {
    descCache.set(name, "");
    return "";
  }
}
