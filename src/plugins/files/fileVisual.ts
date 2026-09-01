/**
 * 默认文件视觉 provider —— 通过 kernel/fileVisual 注册点暴露。
 * 用户插件可注册 order 更小的 provider 覆盖默认。
 */

import type { FileVisualProvider } from "@kernel/fileVisual";

function fileColorClass(name: string, isDir: boolean): string {
  if (isDir) return "text-sky-400";
  if (name.startsWith(".")) return "text-neutral-500";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "md":
      return "text-orange-400";
    case "ts":
    case "tsx":
      return "text-blue-400";
    case "js":
    case "jsx":
      return "text-yellow-400";
    case "json":
      return "text-amber-400";
    case "rs":
      return "text-orange-500";
    case "toml":
      return "text-purple-400";
    case "css":
      return "text-pink-400";
    case "java":
      return "text-red-400";
    case "xml":
      return "text-teal-400";
    case "py":
      return "text-green-400";
    case "go":
      return "text-cyan-400";
    case "yml":
    case "yaml":
      return "text-rose-400";
    default:
      return "text-neutral-300";
  }
}

function fileGlyph(name: string, isDir: boolean): string {
  if (isDir) return "▸";
  if (name.startsWith(".")) return "·";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "md":
      return "M↓";
    case "ts":
    case "tsx":
      return "TS";
    case "js":
    case "jsx":
      return "JS";
    case "rs":
      return "Rs";
    case "toml":
      return "T";
    case "css":
      return "#";
    case "json":
      return "{ }";
    case "java":
      return "☕";
    case "xml":
      return "<>";
    case "py":
      return "Py";
    case "go":
      return "Go";
    default:
      return "·";
  }
}

export const defaultFileVisualProvider: FileVisualProvider = {
  order: 100,
  match(name, isDir) {
    return {
      glyph: fileGlyph(name, isDir),
      colorClass: fileColorClass(name, isDir),
    };
  },
};
