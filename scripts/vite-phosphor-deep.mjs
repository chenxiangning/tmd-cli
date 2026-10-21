/**
 * phosphor barrel 深路径改写(vite 插件,0.4.2 批四):
 * `import { X, Y, type T } from "@phosphor-icons/react"` →
 * `import type { T } from "@phosphor-icons/react"`(纯类型,esbuild 擦除)+
 * 逐图标 `import { X } from "@phosphor-icons/react/dist/csr/X"`。
 * 动机:barrel 预打包 chunk 全量 ~1500 图标,dev 冷加载浏览器要整段求值
 * (0.4.1 tabClose 打桩 42s→3.2s 的根因尾巴);改写后 dev 只装载用到的
 * 图标模块。prod 构建产物不变(barrel 本就 sideEffects:false 可摇树)。
 * 全仓 312 条语句均为命名导入(无 namespace/动态/再导出,2026-10-21 实证;
 * 多行语句亦存在,RE 跨行匹配覆盖),类型成员只有 Icon/IconProps 两个
 * (csr 深路径无类型面,留 barrel)。已知天花板:改写扩行 + map:null 使
 * 这些文件 dev sourcemap/断点行号整体下移 N-1 行(仅 dev 体验,功能无损)。
 * @type {import("vite").Plugin}
 */
export function phosphorDeepImports() {
  const RE = /import\s*\{([^}]*)\}\s*from\s*"(?:@phosphor-icons\/react)";?/g;
  return {
    name: "phosphor-deep-imports",
    enforce: "pre",
    transform(code, id) {
      if (!id.match(/\.[cm]?[jt]sx?$/) || !code.includes('"@phosphor-icons/react"')) return null;
      let touched = false;
      const out = code.replace(RE, (_, specifiers) => {
        const names = specifiers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const types = names.filter((n) => n.startsWith("type "));
        const values = names
          .filter((n) => !n.startsWith("type "))
          .map((n) => {
            const [imported, local] = n.split(/\s+as\s+/);
            return { imported, local: local ?? imported };
          });
        if (values.length === 0) return `import { ${names.join(", ")} } from "@phosphor-icons/react";`;
        touched = true;
        const lines = [];
        if (types.length > 0) lines.push(`import { ${types.join(", ")} } from "@phosphor-icons/react";`);
        for (const { imported, local } of values) {
          /* csr 无 XxxIcon 后缀模块:裸名同件,import as 保本地名;
           * IconContext 唯一非图标值,住 lib/context。 */
          const as = local === imported ? imported : `${imported} as ${local}`;
          if (imported === "IconContext") lines.push(`import { IconContext as ${local} } from "@phosphor-icons/react/dist/lib/context";`);
          else if (imported.endsWith("Icon")) lines.push(`import { ${imported.slice(0, -4)} as ${local} } from "@phosphor-icons/react/dist/csr/${imported.slice(0, -4)}";`);
          else lines.push(`import { ${as} } from "@phosphor-icons/react/dist/csr/${imported}";`);
        }
        return lines.join("\n");
      });
      return touched ? { code: out, map: null } : null;
    },
  };
}
