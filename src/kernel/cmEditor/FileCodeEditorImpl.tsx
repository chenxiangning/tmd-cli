/**
 * CodeMirror 编辑器实现 —— 照抄 codemoss FileCodeMirrorEditorImpl 的最小面:
 * 受控 value/onChange + Mod-S 键位 + 语言懒加载 + 明暗主题跟随应用。
 *
 * 本体只经 FileCodeEditor.tsx 的 lazy 壳动态进入:重型 @uiw/@codemirror 全家桶
 * (含 cmTheme/cmLanguage)随之拆独立 chunk,静态图零牵连。
 *
 * cmd+s 统一走 window 捕获(useFileDocument),这里不再注册第二份键位。
 * 父级用 key={path} 控制重建,本组件无需处理切文件。
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Extension } from "@codemirror/state";
import { t } from "@kernel/i18n";
import { loadCmLanguage } from "./cmLanguage";
import { loadCmTheme } from "./cmTheme";

/* CodeMirror 全家动态加载(本文件本身已处 lazy chunk;再拆一层让 @uiw 只在
   首次真正挂载编辑器时进网络,与 loadCmLanguage/loadCmTheme 同策略)。 */
const CodeMirror = lazy(() => import("@uiw/react-codemirror").then((m) => ({ default: m.default })));

/** 基础键位扩展(Mod-s 保存 + Tab 缩进):与 CodeMirror 全家同批动态加载。 */
async function loadBaseExts(onSave: () => void): Promise<Extension[]> {
  const [{ keymap }, { indentWithTab }] = await Promise.all([
    import("@codemirror/view"),
    import("@codemirror/commands"),
  ]);
  return [
    keymap.of([
      {
        key: "Mod-s",
        run: () => {
          onSave();
          return true;
        },
      },
      indentWithTab,
    ]),
  ];
}

export interface FileCodeEditorProps {
  path: string;
  value: string;
  dark: boolean;
  /** 只读(远程 WSL 文件等无写回通道的场景);缺省可编辑。 */
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export default function FileCodeEditorImpl({
  path,
  value,
  dark,
  readOnly = false,
  onChange,
  onSave,
}: FileCodeEditorProps) {
  const [langExts, setLangExts] = useState<Extension[]>([]);
  const [themeExts, setThemeExts] = useState<Extension[]>([]);
  const [baseExts, setBaseExts] = useState<Extension[]>([]);
  /* saveRef 模式(codemoss 同款):异步键位扩展持有 ref,同时总调最新回调。 */
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  });

  /* 语言包懒加载:首次打开该类型文件才拉 chunk;切换语言失败降级纯文本。 */
  useEffect(() => {
    let cancelled = false;
    loadCmLanguage(path)
      .then((exts) => {
        if (!cancelled) setLangExts(exts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);

  /* 主题异步加载(per-dark 缓存):明暗切换重拉,失败保留旧主题。
     基础键位同批加载(import 模块级缓存,重复调用零成本)。 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const exts = await loadCmTheme(dark);
        if (!cancelled) setThemeExts(exts);
        const base = await loadBaseExts(() => saveRef.current());
        if (!cancelled) setBaseExts(base);
      } catch {
        /* 主题/键位加载失败:保留旧值,编辑器以无主题扩展降级。 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dark]);

  return (
    <Suspense
      fallback={
        <div className="h-full w-full" role="status" aria-label={t("加载编辑器…")} />
      }
    >
    <CodeMirror
      className="fvp-cm"
      value={value}
      onChange={onChange}
      /* 只读 = 不可编辑(内容仍可选可复制);Mod-s 键位保留,由 save 早退兜底 */
      editable={!readOnly}
      /* theme="none":关掉 @uiw 内置明暗主题,配色全走 cmEditorTheme(--tmd token) */
      theme="none"
      extensions={[...themeExts, ...baseExts, ...langExts]}
      height="100%"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        highlightActiveLine: true,
        indentOnInput: true,
        tabSize: 2,
        /* 默认高亮样式(固定色)关闭,统一用 cmTheme 的 --tmd-syntax-* 高亮 */
        syntaxHighlighting: false,
      }}
    />
    </Suspense>
  );
}
