/**
 * GitHub 链接导入(2026-10-18)── 粘贴 github.com 仓库链接直接下载 zip 并
 * 发现其中技能:仓库页 / /tree 分支页(取首段为 ref,子路径忽略,发现层扫
 * 全仓自选)/ .git 后缀 / git@ SSH 形态 / 裸 owner/repo。归档 URL 走
 * github.com/archive/<ref>.zip(302 → codeload,netDownload 跟随重定向);
 * 无 ref 用 HEAD.zip 取默认分支,免一次 API 查询。多段分支名(tree/a/b)无
 * API 无法与子目录消歧,只取首段,下载失败原样带 URL 报错。发现/落位复用
 * importFromDisk + ImportDialog,本文件只负责「链接 → 已解压目录」。
 */
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";

export interface GithubRef {
  owner: string;
  repo: string;
  /** /tree/<ref> 或 /blob/<ref> 的首段;缺省 = 默认分支(HEAD)。 */
  ref?: string;
}

const BARE_REPO = /^([A-Za-z\d][A-Za-z\d-]*)\/([A-Za-z\d._-]+)$/;
const WWW_HOST = /^(?:https?:\/\/)?(?:www\.)?github\.com\//i;

/** 识别不了的输入返回 null(报错文案由调用方给)。 */
export function parseGithubSkillUrl(input: string): GithubRef | null {
  const s = input.trim().replace(/\/+$/, "");
  if (!s) return null;
  const ssh = s.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i);
  if (ssh) return refFrom(ssh[1], ssh[2]);
  if (WWW_HOST.test(s)) {
    const m = s.match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/\s]+)(?:\/.*)?)?$/i,
    );
    if (m) return refFrom(m[1], m[2], m[3]);
    return null;
  }
  const bare = s.match(BARE_REPO);
  return bare ? refFrom(bare[1], bare[2]) : null;
}

function refFrom(owner: string, repoRaw: string, ref?: string): GithubRef | null {
  const repo = repoRaw.replace(/\.git$/i, "");
  /* `..` 防 URL 路径逃逸(owner/repo 白名单外的字符本就被正则挡住)。 */
  if (owner.includes("..") || repo.includes("..")) return null;
  return { owner, repo, ...(ref ? { ref } : {}) };
}

/** 归档下载 URL(单段 ref 对分支与标签都成立,github 路由自行消歧)。 */
export function githubArchiveUrl(ref: GithubRef): string {
  const base = `https://github.com/${ref.owner}/${ref.repo}/archive`;
  return ref.ref ? `${base}/${ref.ref}.zip` : `${base}/HEAD.zip`;
}

export interface GithubImportResult {
  /** 展示名(repo 或 repo@ref)。 */
  label: string;
  /** 解压目录(发现层输入)。 */
  dir: string;
  /** 待清理根(zip + 解压产物;调用方登记,视图卸载时删)。 */
  root: string;
}

/** 下载并解压;失败清理半成品后原样抛(netDownload 错误自带 HTTP 状态)。 */
export async function importGithubArchive(url: string): Promise<GithubImportResult> {
  const ref = parseGithubSkillUrl(url);
  if (!ref) throw new Error(t("无法识别的 GitHub 链接"));
  const root = `${await ipc.configDir()}/cache/skills/import-gh-${Date.now().toString(36)}`;
  try {
    const dl = await ipc.netDownload(githubArchiveUrl(ref), root);
    const dir = `${root}/x`;
    await ipc.skillExtract(dl.path, dir, false);
    return { label: `${ref.repo}${ref.ref ? `@${ref.ref}` : ""}`, dir, root };
  } catch (e) {
    await ipc.fsRemovePath(root).catch(() => undefined);
    throw e;
  }
}
