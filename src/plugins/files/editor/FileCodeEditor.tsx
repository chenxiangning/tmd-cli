/**
 * CodeMirror 编辑器封装 —— 照抄 codemoss FileCodeMirrorEditorImpl 的最小面:
 * 受控 value/onChange + Mod-S 键位 + 语言懒加载 + 明暗主题跟随应用。
 *
 * cmd+s 统一走 window 捕获(useFileDocument),这里不再注册第二份键位。
 * 父级用 key={path} 控制重建,本组件无需处理切文件。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { loadCmLanguage } from "./cmLanguage";
import { cmEditorTheme } from "./cmTheme";

export function FileCodeEditor({
  path,
  value,
  dark,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  dark: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const [langExts, setLangExts] = useState<Extension[]>([]);

  /* 语言包懒加载:首次打开该类型文件才拉 chunk;切换语言失败降级纯文本。 */
  useEffect(() => {
    let cancelled = false;
    void loadCmLanguage(path).then((exts) => {
      if (!cancelled) setLangExts(exts);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  /* saveRef 模式(codemoss 同款):键位扩展 memo 化,同时总调最新回调。 */
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const baseExts = useMemo<Extension[]>(
    () => [
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            saveRef.current();
            return true;
          },
        },
        indentWithTab,
      ]),
    ],
    [],
  );
  /* 主题扩展吃 --tmd-syntax-* token,随应用明暗重建。 */
  const themeExts = useMemo(() => cmEditorTheme(dark), [dark]);

  return (
    <CodeMirror
      className="fvp-cm"
      value={value}
      onChange={onChange}
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
  );
}
