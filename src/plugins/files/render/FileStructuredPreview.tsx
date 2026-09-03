/**
 * 结构化预览(shell 脚本 / Dockerfile)—— 照抄 codemoss FileStructuredPreview.tsx。
 *
 * shell:注释段 + 命令段分区,shebang 横幅;Dockerfile:注释段 + 指令卡片
 * (关键字 pill + 摘要 + 续行合并的原文)。超预算(120KB/3000 行)回退
 * 只展示前 240 行的 bounded 视图。代码高亮复用 markdown 管线的 highlightLine。
 * 与 codemoss 差异:i18n 硬编码中文。
 */

import { useMemo } from "react";
import { highlightLine } from "../markdown/syntax";
import { resolveStructuredPreviewKind } from "./renderProfile";
import {
  createFileDocumentSnapshot,
  type FileDocumentSnapshot,
} from "./documentSnapshot";

const STRUCTURED_PREVIEW_MAX_PARSE_BYTES = 120_000;
const STRUCTURED_PREVIEW_MAX_PARSE_LINES = 3_000;
const STRUCTURED_PREVIEW_FALLBACK_LINES = 240;

type ShellSection = {
  notes: string[];
  commands: string[];
};

type DockerInstruction = {
  keyword: string;
  summary: string;
  raw: string;
};

type DockerSection = {
  notes: string[];
  instructions: DockerInstruction[];
};

function parseShellPreview(value: string) {
  const lines = value.split(/\r?\n/);
  const sections: ShellSection[] = [];
  let shebang = "";
  let currentNotes: string[] = [];
  let currentCommands: string[] = [];

  const flushSection = () => {
    if (currentNotes.length === 0 && currentCommands.length === 0) {
      return;
    }
    sections.push({
      notes: currentNotes,
      commands: currentCommands,
    });
    currentNotes = [];
    currentCommands = [];
  };

  lines.forEach((line, index) => {
    if (index === 0 && line.startsWith("#!")) {
      shebang = line;
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushSection();
      return;
    }

    if (trimmed.startsWith("#")) {
      if (currentCommands.length > 0) {
        flushSection();
      }
      currentNotes.push(trimmed.replace(/^#+\s?/, ""));
      return;
    }

    currentCommands.push(line);
  });

  flushSection();

  return { shebang, sections };
}

export { parseShellPreview };

function parseDockerfilePreview(value: string) {
  const lines = value.split(/\r?\n/);
  const sections: DockerSection[] = [];
  let currentNotes: string[] = [];
  let currentInstructions: DockerInstruction[] = [];
  let pendingInstruction: string[] = [];

  const flushInstructions = () => {
    if (currentNotes.length === 0 && currentInstructions.length === 0) {
      return;
    }
    sections.push({
      notes: currentNotes,
      instructions: currentInstructions,
    });
    currentNotes = [];
    currentInstructions = [];
  };

  const flushPendingInstruction = () => {
    if (pendingInstruction.length === 0) {
      return;
    }
    const raw = pendingInstruction.join("\n");
    const [firstLine] = pendingInstruction;
    if (!firstLine) {
      pendingInstruction = [];
      return;
    }
    const trimmedFirstLine = firstLine.trim();
    const separatorIndex = trimmedFirstLine.indexOf(" ");
    const keyword = (
      separatorIndex > 0
        ? trimmedFirstLine.slice(0, separatorIndex)
        : trimmedFirstLine
    ).toUpperCase();
    const summary = (
      separatorIndex > 0
        ? trimmedFirstLine.slice(separatorIndex + 1)
        : ""
    ).trim();
    currentInstructions.push({
      keyword,
      summary,
      raw,
    });
    pendingInstruction = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPendingInstruction();
      flushInstructions();
      return;
    }

    if (trimmed.startsWith("#")) {
      flushPendingInstruction();
      if (currentInstructions.length > 0) {
        flushInstructions();
      }
      currentNotes.push(trimmed.replace(/^#+\s?/, ""));
      return;
    }

    pendingInstruction.push(line);
    if (!trimmed.endsWith("\\")) {
      flushPendingInstruction();
    }
  });

  flushPendingInstruction();
  flushInstructions();

  return sections;
}

export { parseDockerfilePreview };

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
      {sections.map((section, index) => (
        <section
          key={`shell-${index}`}
          className="fvp-structured-preview-section"
        >
          {section.notes.length > 0 ? (
            <div className="fvp-structured-preview-notes">
              {section.notes.map((note, noteIndex) => (
                <p key={`note-${index}-${noteIndex}`}>{note}</p>
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
          key={`docker-${sectionIndex}`}
          className="fvp-structured-preview-section"
        >
          {section.notes.length > 0 ? (
            <div className="fvp-structured-preview-notes">
              {section.notes.map((note, noteIndex) => (
                <p key={`docker-note-${sectionIndex}-${noteIndex}`}>{note}</p>
              ))}
            </div>
          ) : null}
          {section.instructions.length > 0 ? (
            <div className="fvp-structured-preview-stack">
              {section.instructions.map((instruction, instructionIndex) => (
                <article
                  key={`docker-instruction-${sectionIndex}-${instructionIndex}`}
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
            {`文件较大,仅展示前 ${visibleLineCount} / ${documentSnapshot.lineCount} 行`}
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
