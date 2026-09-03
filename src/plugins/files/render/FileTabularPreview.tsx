/**
 * 表格文件预览(csv/xls/xlsx)—— 照抄 codemoss FileTabularPreview.tsx。
 *
 * xlsx 库懒加载;csv 走文本(fileCache 内容),xls/xlsx 走二进制字节通道。
 * 展示上限:200 行 × 30 列 + 截断提示;多 sheet 页签切换。
 * 与 codemoss 差异:i18n 硬编码中文;数据源统一为本地 text/bytes
 * (codemoss 的 asset:// fetch 改为 readBinaryFileBase64)。
 */

import { useEffect, useMemo, useState } from "react";
import type { WorkBook } from "xlsx";
import { loadPreviewBytes } from "./previewBytes";
import { isTabularBinaryPath } from "./renderProfile";

type FileTabularPreviewProps = {
  path: string;
  /** csv 文本(由 fileCache 提供);xls/xlsx 传 null,内部走字节通道。 */
  text: string | null;
};

type ParsedSheet = {
  name: string;
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  rowTruncated: boolean;
  columnTruncated: boolean;
};

const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 30;
const MAX_TABULAR_PREVIEW_MB = 8;

function normalizeCell(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type SheetInput =
  | { kind: "text"; text: string }
  | { kind: "bytes"; path: string };

function resolveSheetInput(path: string, text: string | null): SheetInput | null {
  if (isTabularBinaryPath(path)) {
    return { kind: "bytes", path };
  }
  if (text != null) {
    return { kind: "text", text };
  }
  return null;
}

/* xlsx 库 ~400KB,静态 import 会拖进主 chunk;与编辑器/markdown 预览同款
   懒加载纪律 —— 真正打开表格文件才拉取。 */
async function parseSheets(input: SheetInput): Promise<ParsedSheet[]> {
  const XLSX = await import("xlsx");
  let workbook: WorkBook;
  if (input.kind === "text") {
    workbook = XLSX.read(input.text, {
      type: "string",
      raw: false,
    });
  } else {
    const bytes = await loadPreviewBytes(input.path);
    workbook = XLSX.read(bytes, {
      type: "array",
      raw: false,
    });
  }

  return workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = (
      XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: false,
        blankrows: false,
        defval: "",
      }) as unknown[][]
    ).map((row) => row.map(normalizeCell));
    const totalColumns = rawRows.reduce(
      (maxColumns, row) => Math.max(maxColumns, row.length),
      0,
    );
    return {
      name: sheetName,
      rows: rawRows
        .slice(0, MAX_TABLE_ROWS)
        .map((row) => row.slice(0, MAX_TABLE_COLUMNS)),
      totalRows: rawRows.length,
      totalColumns,
      rowTruncated: rawRows.length > MAX_TABLE_ROWS,
      columnTruncated: totalColumns > MAX_TABLE_COLUMNS,
    };
  });
}

export function FileTabularPreview({ path, text }: FileTabularPreviewProps) {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(true);

  useEffect(() => {
    const input = resolveSheetInput(path, text);
    if (!input) {
      setSheets([]);
      setActiveSheetIndex(0);
      setParseError("表格预览不可用");
      setIsParsing(false);
      return;
    }

    let cancelled = false;
    setIsParsing(true);
    setParseError(null);

    void (async () => {
      try {
        if (input.kind === "bytes") {
          /* Rust 侧 8MB 闸已挡;这里再校验一次,防御非 Tauri 通道的旁路数据。 */
          const bytes = await loadPreviewBytes(input.path);
          if (bytes.byteLength > MAX_TABULAR_PREVIEW_MB * 1024 * 1024) {
            throw new Error(`文件超过 ${MAX_TABULAR_PREVIEW_MB}MB,不支持表格预览`);
          }
        }
        const nextSheets = await parseSheets(input);
        if (!cancelled) {
          setSheets(nextSheets);
          setActiveSheetIndex(0);
          setParseError(nextSheets.length === 0 ? "表格为空" : null);
          setIsParsing(false);
        }
      } catch (parseFailure) {
        if (!cancelled) {
          setSheets([]);
          setActiveSheetIndex(0);
          setParseError(
            parseFailure instanceof Error ? parseFailure.message : String(parseFailure),
          );
          setIsParsing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, text]);

  const activeSheet = useMemo(
    () => sheets[activeSheetIndex] ?? null,
    [activeSheetIndex, sheets],
  );

  if (isParsing) {
    return <div className="fvp-status">加载中…</div>;
  }

  if (parseError) {
    return <div className="fvp-status fvp-error">{parseError}</div>;
  }

  if (!activeSheet) {
    return <div className="fvp-status">表格预览不可用</div>;
  }

  const hasAnyCell = activeSheet.rows.some((row) => row.some((cell) => cell.length > 0));
  const showTruncationHint = activeSheet.rowTruncated || activeSheet.columnTruncated;

  return (
    <div className="fvp-preview-scroll">
      <div className="fvp-tabular-preview">
        <header className="fvp-preview-section-header">
          <strong>表格预览</strong>
          <span>{`${activeSheet.totalRows} 行 · ${activeSheet.totalColumns} 列`}</span>
        </header>
        {sheets.length > 1 ? (
          <div className="fvp-tabular-sheet-tabs" role="tablist" aria-label="工作表">
            {sheets.map((sheet, index) => (
              <button
                key={sheet.name}
                type="button"
                className={`fvp-tabular-sheet-tab${index === activeSheetIndex ? " is-active" : ""}`}
                onClick={() => setActiveSheetIndex(index)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        ) : null}
        {showTruncationHint ? (
          <div className="fvp-preview-budget-hint">
            {`仅展示前 ${MAX_TABLE_ROWS} 行 × ${MAX_TABLE_COLUMNS} 列`}
          </div>
        ) : null}
        {hasAnyCell ? (
          <div className="fvp-tabular-table-wrap">
            <table className="fvp-tabular-table">
              <tbody>
                {activeSheet.rows.map((row, rowIndex) => (
                  <tr key={`sheet-row-${rowIndex}`}>
                    {Array.from({
                      length: Math.max(row.length, 1),
                    }).map((_, columnIndex) => (
                      <td key={`sheet-cell-${rowIndex}-${columnIndex}`}>
                        {row[columnIndex] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="fvp-status">表格为空</div>
        )}
      </div>
    </div>
  );
}
