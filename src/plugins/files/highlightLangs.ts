/**
 * 文件扩展 → highlight.js lang id —— 纯函数映射,不依赖 hljs。
 *
 * 单独成文件的原因:files/index.tsx 的 supports 判定只需这张表,
 * 若与高亮实现同文件,静态 import 会把 hljs 整个 chunk 拉进主包,
 * 懒加载(动态 import ./highlighter)就失效了。
 */

export function extToLang(path: string): string | null {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "java":
      return "java";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "toml":
      return "toml";
    case "xml":
    case "html":
      return "xml";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
      return "bash";
    case "css":
      return "css";
    case "go":
      return "go";
    default:
      return null;
  }
}
