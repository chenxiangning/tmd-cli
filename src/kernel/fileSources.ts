/**
 * 远程文件源注册表 —— 右栏文件树的远程浏览/读取协议。
 *
 * 为什么存在:某类工作区的文件不在本机文件系统(如 WSL 远程宿主的 Linux 路径),
 * files 插件的文件树/渲染管线不应知晓任何具体远端 —— 这里只定义协议:来源插件
 * activate 时注册(浏览 = listDir,打开 = fileUri + readText),禁用插件重启后
 * 不激活 = 注册表为空,files 对这类工作区显示通用降级(数据仍在,能力随插件)。
 *
 * 文件 URI:来源自定义 scheme(如 wslr://...),fileCache/编辑器按 ownsUri
 * 分派读取通道;URI 字符集纪律由来源保证(Rust 侧路径白名单背书)。
 */

import { createSubscribable } from "./subscribable";
import type { DirEntry } from "./ipc";
import type { Workspace } from "./workspace";

export interface RemoteFileSource {
  /** 稳定 id(= 文件 URI scheme 前缀,如 "wslr")。 */
  id: string;
  /** 该源服务哪些工作区(活动工作区命中即接管右栏文件树;多命中取先注册)。 */
  appliesTo(ws: Workspace): boolean;
  /** 宿主识别头文案(发行版 · 主机名等,树顶部一行)。 */
  label(ws: Workspace): string;
  /** root 下相对远程路径列目录(只读;展开懒加载逐级调用)。 */
  listDir(ws: Workspace, path: string): Promise<DirEntry[]>;
  /** 工作区内某路径 → 文件打开 URI(scheme://...)。 */
  fileUri(ws: Workspace, path: string): string;
  /** 该 URI 是否归本源(前缀判定,渲染管线加载分派用)。 */
  ownsUri(path: string): boolean;
  /** 文件 URI → 文本(上限由调用方给;超限如实 reject)。 */
  readText(uri: string, maxBytes: number): Promise<string>;
}

let sources: RemoteFileSource[] = [];
const store = createSubscribable<{ sources: readonly RemoteFileSource[] }>({ sources });

/** 注册远程文件源(activate 期调用);返回退订函数。 */
export function registerRemoteFileSource(source: RemoteFileSource): () => void {
  sources = [...sources, source];
  store.commit({ sources });
  return () => {
    sources = sources.filter((s) => s !== source);
    store.commit({ sources });
  };
}

/** 活动工作区命中的文件源(无 = 该工作区无远程浏览能力)。 */
export function findRemoteFileSource(ws: Workspace): RemoteFileSource | null {
  return sources.find((s) => s.appliesTo(ws)) ?? null;
}

/** 文件 URI 归属的文件源(渲染管线加载分派;无 = 非远程或来源未启用)。 */
export function findRemoteFileSourceForUri(path: string): RemoteFileSource | null {
  return sources.find((s) => s.ownsUri(path)) ?? null;
}

/** path 是否任何已注册来源的文件 URI(只读判定;来源未启用 = false)。 */
export function isRemoteFileUri(path: string): boolean {
  return sources.some((s) => s.ownsUri(path));
}
