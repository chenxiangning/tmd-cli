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
import type { EditorView } from "@codemirror/view";
import { t } from "@kernel/i18n";
import { useEditorExtensionFactories } from "@kernel/editorExtensions";
import { loadCmLanguage } from "./cmLanguage";
import { loadCmTheme } from "./cmTheme";

/* CodeMirror 全家动态加载(本文件本身已处 lazy chunk;再拆一层让 @uiw 只在
   首次真正挂载编辑器时进网络,与 loadCmLanguage/loadCmTheme 同策略)。 */
const CodeMirror = lazy(() => import("@uiw/react-codemirror").then((m) => ({ default: m.default })));

/** 基础键位 + 编辑器内查找扩展(Mod-s 保存 / Tab 缩进 / Mod-f 查找面板):
 * 与 CodeMirror 全家同批动态加载;@uiw basicSetup 不含搜索,显式补。 */
async function loadBaseExts(onSave: () => void): Promise<Extension[]> {
  const [{ keymap }, { indentWithTab }, { search, openSearchPanel }] = await Promise.all([
    import("@codemirror/view"),
    import("@codemirror/commands"),
    import("@codemirror/search"),
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
      { key: "Mod-f", run: openSearchPanel },
    ]),
    search({ top: true }),
  ];
}

export interface FileCodeEditorProps {
  path: string;
  value: string;
  dark: boolean;
  /** 只读(远程 WSL 文件等无写回通道的场景);缺省可编辑。 */
  readOnly?: boolean;
  /** 定位行(1 基;变化时滚动+选中该行,全文搜索命中跳转用)。 */
  revealLine?: number | null;
  /** 定位序号:同值行号的重复命中靠它打破 React bail-out 重新定位。 */
  revealSeq?: number;
  onChange: (value: string) => void;
  onSave: () => void;
}

export default function FileCodeEditorImpl({
  path,
  value,
  dark,
  readOnly = false,
  revealLine,
  revealSeq = 0,
  onChange,
  onSave,
}: FileCodeEditorProps) {
  const [langExts, setLangExts] = useState<Extension[]>([]);
  const [themeExts, setThemeExts] = useState<Extension[]>([]);
  const [baseExts, setBaseExts] = useState<Extension[]>([]);
  const [pluginExts, setPluginExts] = useState<readonly Extension[]>([]);
  const editorViewRef = useRef<EditorView | null>(null);
  const extFactories = useEditorExtensionFactories();
  /* saveRef 模式(codemoss 同款):异步键位扩展持有 ref,同时总调最新回调。 */
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  });

  /* 行定位:视图可能晚于 revealLine 就绪(异步 chunk),onCreateEditor 补一次
     消费;两处共用同一实现(CM 模块此场景已在缓存,import 即时)。 */
  const revealLineRef = useRef<number | null>(revealLine ?? null);
  useEffect(() => {
    /* 渲染期不写 ref(react-doctor):prop → ref 同步收敛到 effect。 */
    revealLineRef.current = revealLine ?? null;
  }, [revealLine]);
  const revealEditorLine = async (view: EditorView, lineNo: number): Promise<void> => {
    const [stateMod, viewMod] = await Promise.all([
      import("@codemirror/state"),
      import("@codemirror/view"),
    ]);
    const clamped = Math.min(Math.max(lineNo, 1), view.state.doc.lines);
    const pos = view.state.doc.line(clamped).from;
    view.dispatch({
      selection: stateMod.EditorSelection.cursor(pos),
      effects: viewMod.EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  };
  useEffect(() => {
    const view = editorViewRef.current;
    const lineNo = revealLineRef.current;
    if (view && lineNo) {
      void revealEditorLine(view, lineNo);
    }
    /* revealSeq 只是重触发信号(同值行号的重复定位),不进函数体。 */
  }, [revealLine, revealSeq]);

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

  /* 插件扩展组(editorExtensions 注册表):工厂清单/文件/明暗任一变化重跑。
     单厂抛错只丢该厂产物;CM 类型对插件侧是 type-only,运行期加载归工厂体内。 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const groups = await Promise.all(
        extFactories.map((build) => build({ path, dark }).catch(() => null)),
      );
      if (!cancelled) {
        setPluginExts(groups.flat().filter((ext): ext is Extension => ext != null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, dark, extFactories]);

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
      extensions={[...themeExts, ...baseExts, ...langExts, ...pluginExts]}
      onCreateEditor={(view) => {
        editorViewRef.current = view;
        const lineNo = revealLineRef.current;
        if (lineNo) {
          void revealEditorLine(view, lineNo);
        }
      }}
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
