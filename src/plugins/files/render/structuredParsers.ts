/**
 * 结构化预览解析器 —— 自 FileStructuredPreview.tsx 拆出(文件规模铁则)。
 *
 * 纯解析、无渲染:shell 脚本切注释段 + 命令段(识别 shebang);
 * Dockerfile 切注释段 + 指令卡片(关键字 / 摘要 / 续行合并的原文)。
 * FileStructuredPreview 保留 re-export 以维持既有导入契约。
 */

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

export function parseShellPreview(value: string) {
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

export function parseDockerfilePreview(value: string) {
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
