/**
 * jdt.ls 安装器 —— curl/tar 子进程实现(浏览器 fetch 有 CORS 墙,curl 无;
 * Win10+ 自带 curl.exe/tar.exe)。
 *
 * 里程碑源:download.eclipse.org/jdtls/milestones/<ver>/latest.txt 解析文件名。
 * 装到 ~/.tmd-cli/lsp/jdt/,installed.json 留 launch 描述供 discoverJava 消费。
 * ponytail:经 procCommunicate 一锤子下载+解压,无进度流;下载失败让用户重点。
 */

import { ipc } from "@kernel/ipc";

/* 钉 1.40.0:≥1.46 的 OSGi bundle 要求 JavaSE 21(PATH java=17 的机器全悬空,
   initialize 永不回应 —— 2026-09-19 真机实证);升版本前先确认 JDK 门槛。 */
const MILESTONE = "1.40.0";

/** darwin/linux 上 uname -m 判 ARM(jdt.ls 的 config 目录分 mac / mac_arm)。 */
async function configSuffix(): Promise<string> {
  if (navigator.userAgent.includes("Windows")) return "win";
  const res = await ipc
    .procCommunicate({ command: "uname", args: ["-m"], cwd: ".", closeStdin: true, timeoutMs: 5000 })
    .catch(() => null);
  const arm = /arm64|aarch64/.test(res?.stdout ?? "");
  if (navigator.userAgent.includes("Mac")) return arm ? "mac_arm" : "mac";
  return arm ? "linux_arm" : "linux";
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

  /* curl -o / fs_create_dir(单级不递归)都要求父目录先在:
     ~/.tmd-cli 存在,lsp 一级先建,否则 curl 56 写入失败 + 解压报父目录不存在。 */
  await ipc.fsCreateDir(root).catch(() => {});
  onStatus(`下载 ${fileName}(约 100MB,首次较慢)`);
  await run("curl", ["-sSL", "-o", `${root}/jdt.tar.gz`, `https://download.eclipse.org/jdtls/milestones/${MILESTONE}/${fileName}`], home, 600_000);

  onStatus("解压");
  await ipc.fsRemovePath(dir).catch(() => {});
  await ipc.fsCreateDir(dir).catch(() => {});
  await run("tar", ["-xzf", `${root}/jdt.tar.gz`, "-C", dir], home, 120_000);

  onStatus("登记安装描述");
  const plugins = await ipc.fsListDir(`${dir}/plugins`).catch(() => []);
  /* OSGi 版本带限定段(1.7.0.v20250519-0528);平台专版是 launcher.<os>.<arch>_,锚 launcher_ 排除。 */
  const launcher = plugins.find((e) => /^org\.eclipse\.equinox\.launcher_[0-9][\w.-]*\.jar$/.test(e.name));
  if (!launcher) throw new Error("解压产物中未找到 equinox launcher");
  const configDir = `${dir}/config_${await configSuffix()}`;
  await ipc.fsWriteFile(`${dir}/installed.json`, JSON.stringify({ launcherJar: launcher.path, configDir }));
  await ipc.fsRemovePath(`${root}/jdt.tar.gz`).catch(() => {});
}
