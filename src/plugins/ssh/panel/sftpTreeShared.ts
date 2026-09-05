/**
 * SftpTree 共享原语 —— 自 SftpTree.tsx 拆出(文件规模铁则)。
 *
 * 单一节点注册表的节点类型、右键菜单状态类型、远端路径工具、
 * 下载/上传传输动作(菜单与工具条共用)。
 */

import { ipc, pickDirectory, pickFile, type SftpEntry } from "@kernel/ipc";

export interface TreeNode {
  path: string;
  name: string;
  kind: "dir" | "file";
  expanded: boolean;
  children?: SftpEntry[];
  loading: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}

export function parentPath(path: string) {
  const index = path.lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  return path.slice(0, index);
}

export function joinRemote(parent: string, child: string) {
  if (parent === "." || parent === "") return child;
  if (parent === "/") return `/${child}`;
  return `${parent}/${child}`;
}

export function basenameOf(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export async function downloadNode(sessionId: string, node: TreeNode, recursive: boolean) {
  const target = await pickDirectory("下载到本地目录");
  if (!target) return;
  try {
    const local = node.kind === "dir" ? target : `${target}/${node.name}`;
    await ipc.sftpTransfer(sessionId, "download", node.path, local, recursive);
  } catch (e) {
    window.alert(`下载失败:${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function uploadPicked(sessionId: string, onMutate: () => void, remoteDir = ".") {
  const source = await pickFile("选择要上传的文件");
  if (!source) return;
  const name = source.split(/[\\/]/).pop() ?? "upload";
  try {
    await ipc.sftpTransfer(sessionId, "upload", source, joinRemote(remoteDir, name), false);
    onMutate();
  } catch (e) {
    window.alert(`上传失败:${e instanceof Error ? e.message : String(e)}`);
  }
}
