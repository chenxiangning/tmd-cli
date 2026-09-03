/**
 * 二进制不支态占位 —— 对应 codemoss binary-unsupported 面。
 *
 * 音视频/压缩包/字体/可执行等:明确告知不支持,附「在文件管理器中显示」
 * (ipc.fsRevealInFileManager,codemoss 走外部打开菜单,tmd 用现成命令达成同义兜底)。
 */

import { useState } from "react";
import { ipc } from "@kernel/ipc";

const BINARY_HINT: Record<string, string> = {
  mp3: "音频文件", wav: "音频文件", ogg: "音频文件", flac: "音频文件",
  aac: "音频文件", m4a: "音频文件", wma: "音频文件",
  mp4: "视频文件", mov: "视频文件", avi: "视频文件", mkv: "视频文件",
  wmv: "视频文件", flv: "视频文件", webm: "视频文件",
  zip: "压缩包", tar: "压缩包", gz: "压缩包", rar: "压缩包",
  "7z": "压缩包", bz2: "压缩包",
  ppt: "演示文稿", pptx: "演示文稿",
  exe: "可执行文件", dll: "动态库", so: "动态库", dylib: "动态库",
  bin: "二进制文件", dmg: "磁盘镜像", iso: "磁盘镜像",
  ttf: "字体文件", otf: "字体文件", woff: "字体文件",
  woff2: "字体文件", eot: "字体文件",
  class: "字节码", o: "目标文件", a: "静态库", lib: "静态库",
  pyc: "字节码", wasm: "WebAssembly 模块",
};

export function FileBinaryUnsupported({ path }: { path: string }) {
  const [revealFailed, setRevealFailed] = useState(false);
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const hint = BINARY_HINT[extension];

  return (
    <div className="fvp-binary-unsupported">
      <p>
        {hint ? `${hint},` : "该文件类型"}
        {"暂不支持内置预览。"}
      </p>
      <button
        type="button"
        className="fvp-preview-toolbar-button"
        onClick={() => {
          ipc.fsRevealInFileManager(path).catch(() => setRevealFailed(true));
        }}
      >
        在文件管理器中显示
      </button>
      {revealFailed ? (
        <p className="fvp-error">{path}</p>
      ) : null}
    </div>
  );
}
