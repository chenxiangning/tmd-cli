/**
 * 结构化预览(shell 脚本 / Dockerfile)—— 照抄 codemoss FileStructuredPreview.tsx。
 *
 * shell:注释段 + 命令段分区,shebang 横幅;Dockerfile:注释段 + 指令卡片
 * (关键字 pill + 摘要 + 续行合并的原文)。超预算(120KB/3000 行)回退
 * 只展示前 240 行的 bounded 视图。代码高亮复用 markdown 管线的 highlightLine。
 * 代码高亮复用 markdown 管线的 highlightLine。
 * 与 codemoss 差异:文案走 t() 词典。
 * 纯解析器(parseShellPreview / parseDockerfilePreview)拆至 structuredParsers.ts
 * (文件规模铁则),此处保留 re-export 以维持既有导入契约。
 */

import { useMemo } from "react";
import { highlightLine } from "../markdown/syntax";
import { resolveStructuredPreviewKind } from "./renderProfile";
import { t } from "@kernel/i18n";
import {
  createFileDocumentSnapshot,
  type FileDocumentSnapshot,
} from "./documentSnapshot";
import {
  parseDockerfilePreview,
  parseShellPreview,
} from "./structuredParsers";

export { parseDockerfilePreview, parseShellPreview } from "./structuredParsers";

const STRUCTURED_PREVIEW_MAX_PARSE_BYTES = 120_000;
const STRUCTURED_PREVIEW_MAX_PARSE_LINES = 3_000;
const STRUCTURED_PREVIEW_FALLBACK_LINES = 240;

function ShellPreview({ value, className }: { value: string; className: string }) {
  const { shebang, sections } = useMemo(() => parseShellPreview(value), [value]);

  return (
    <div className={className} data-testid="file-structured-preview">
      {shebang ? (
        <section className="fvp-structured-preview-banner">
          <div className="fvp-structured-preview-banner-label">Shebang</div>
          <code>{shebang}</code>
        </section>
      ) : null}
      {sections.map((section, sectionIndex) => (
        <section
          key={`${sectionIndex}:${JSON.stringify(section)}`}
          className="fvp-structured-preview-section"
        >
          {section.notes.length > 0 ? (
            <div className="fvp-structured-preview-notes">
              {section.notes.map((note, noteIndex) => (
                <p key={`${sectionIndex}-${noteIndex}:${note}`}>{note}</p>
              ))}
            </div>
          ) : null}
          {section.commands.length > 0 ? (
            <div className="fvp-structured-preview-code">
              <div className="fvp-structured-preview-code-label">Commands</div>
              <pre>
                <code
                  dangerouslySetInnerHTML={{
                    __html: highlightLine(section.commands.join("\n"), "bash"),
                  }}
                />
              </pre>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function DockerfilePreview({ value, className }: { value: string; className: string }) {
  const sections = useMemo(() => parseDockerfilePreview(value), [value]);

  return (
    <div className={className} data-testid="file-structured-preview">
      {sections.map((section, sectionIndex) => (
        <section
          key={`${sectionIndex}:${JSON.stringify(section)}`}
          className="fvp-structured-preview-section"
        >
          {section.notes.length > 0 ? (
            <div className="fvp-structured-preview-notes">
              {section.notes.map((note, noteIndex) => (
                <p key={`${sectionIndex}-${noteIndex}:${note}`}>{note}</p>
              ))}
            </div>
          ) : null}
          {section.instructions.length > 0 ? (
            <div className="fvp-structured-preview-stack">
              {section.instructions.map((instruction, instructionIndex) => (
                <article
                  key={`${sectionIndex}-${instructionIndex}:${instruction.raw}`}
                  className="fvp-structured-preview-card"
                >
                  <div className="fvp-structured-preview-card-header">
                    <span className="fvp-structured-preview-pill">
                      {instruction.keyword}
                    </span>
                    {instruction.summary ? (
                      <div className="fvp-structured-preview-summary">
                        {instruction.summary}
                      </div>
                    ) : null}
                  </div>
                  <pre className="fvp-structured-preview-card-code">
                    <code
                      dangerouslySetInnerHTML={{
                        __html: highlightLine(instruction.raw, "bash"),
                      }}
                    />
                  </pre>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function BoundedStructuredFallback({
  documentSnapshot,
  className,
  language,
}: {
  documentSnapshot: FileDocumentSnapshot;
  className: string;
  language: string | null;
}) {
  const visibleLineCount = Math.min(
    STRUCTURED_PREVIEW_FALLBACK_LINES,
    documentSnapshot.lineCount,
  );
  const visibleLines = useMemo(
    () => documentSnapshot.getLines(0, visibleLineCount),
    [documentSnapshot, visibleLineCount],
  );

  return (
    <div className={className} data-testid="file-structured-preview">
      <section className="fvp-structured-preview-section">
        <div className="fvp-structured-preview-code">
          <div className="fvp-structured-preview-code-label">
            {t("文件较大,仅展示前 {visible} / {total} 行", { visible: visibleLineCount, total: documentSnapshot.lineCount })}
          </div>
          <pre>
            <code
              dangerouslySetInnerHTML={{
                __html: highlightLine(visibleLines.join("\n"), language),
              }}
            />
          </pre>
        </div>
      </section>
    </div>
  );
}

export function FileStructuredPreview({
  filePath,
  value,
  className = "fvp-structured-preview",
}: {
  filePath: string;
  value: string;
  className?: string;
}) {
  const documentSnapshot = useMemo(
    () => createFileDocumentSnapshot(value, false, 0),
    [value],
  );
  const previewKind = useMemo(
    () => resolveStructuredPreviewKind(filePath),
    [filePath],
  );
  const exceedsStructuredBudget =
    documentSnapshot.byteLength > STRUCTURED_PREVIEW_MAX_PARSE_BYTES ||
    documentSnapshot.lineCount > STRUCTURED_PREVIEW_MAX_PARSE_LINES ||
    documentSnapshot.truncated;

  if (exceedsStructuredBudget) {
    return (
      <BoundedStructuredFallback
        documentSnapshot={documentSnapshot}
        className={className}
        language={previewKind === "dockerfile" ? "docker" : "bash"}
      />
    );
  }

  if (previewKind === "shell") {
    return <ShellPreview value={value} className={className} />;
  }
  if (previewKind === "dockerfile") {
    return <DockerfilePreview value={value} className={className} />;
  }
  return null;
}
