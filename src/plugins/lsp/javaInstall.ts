/**
 * jdt.ls 安装器 —— curl/tar 子进程实现(浏览器 fetch 有 CORS 墙,curl 无;
 * Win10+ 自带 curl.exe/tar.exe)。
 *
 * 里程碑源:download.eclipse.org/jdtls/milestones/<ver>/latest.txt 解析文件名。
 * 装到 ~/.tmd-cli/lsp/jdt/,installed.json 留 launch 描述供 discoverJava 消费。
 * ponytail:经 procCommunicate 一锤子下载+解压,无进度流;下载失败让用户重点。
 */

import { ipc } from "@kernel/ipc";

const MILESTONE = "1.50.0";

function configSuffix(): string {
  if (navigator.userAgent.includes("Windows")) return "win";
  if (navigator.userAgent.includes("Mac")) return "mac";
  return "linux";
}

async function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  const res = await ipc.procCommunicate({ command, args, cwd, closeStdin: true, timeoutMs });
  if (res.code !== 0) throw new Error(`${command} 退出码 ${res.code}:${res.stderr.slice(0, 200)}`);
  return res.stdout;
}

export async function installJdt(onStatus: (s: string) => void): Promise<void> {
  const home = await ipc.configDir();
  const root = `${home}/lsp`;
  const dir = `${root}/jdt`;

  onStatus("解析最新版本");
  const fileName = (await run("curl", ["-sSL", `https://download.eclipse.org/jdtls/milestones/${MILESTONE}/latest.txt`], home, 30_000)).trim();
  if (!fileName.endsWith(".tar.gz")) throw new Error(`无法解析 jdt.ls 版本:${fileName.slice(0, 60)}`);

  onStatus(`下载 ${fileName}(约 100MB,首次较慢)`);
  await run("curl", ["-sSL", "-o", `${root}/jdt.tar.gz`, `https://download.eclipse.org/jdtls/milestones/${MILESTONE}/${fileName}`], home, 600_000);

  onStatus("解压");
  await ipc.fsRemovePath(dir).catch(() => {});
  await ipc.fsCreateDir(dir).catch(() => {});
  await run("tar", ["-xzf", `${root}/jdt.tar.gz`, "-C", dir], home, 120_000);

  onStatus("登记安装描述");
  const plugins = await ipc.fsListDir(`${dir}/plugins`).catch(() => []);
  const launcher = plugins.find((e) => /^org\.eclipse\.equinox\.launcher_[\d.]+\.jar$/.test(e.name));
  if (!launcher) throw new Error("解压产物中未找到 equinox launcher");
  const configDir = `${dir}/config_${configSuffix()}`;
  await ipc.fsWriteFile(`${dir}/installed.json`, JSON.stringify({ launcherJar: launcher.path, configDir }));
  await ipc.fsRemovePath(`${root}/jdt.tar.gz`).catch(() => {});
}
