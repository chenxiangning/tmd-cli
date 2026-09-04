/**
 * 会话输出环形缓冲存储 —— 从 host.ts 拆出(单文件 ≤500 行铁则)。
 *
 * 每会话分块缓冲:append 只 push 不拼接(高频路径零复制);totalBytes 随 chunk
 * 增量维护,供 TerminalView 翻页锚点反推,消除挂载时全量 TextEncoder 编码。
 * totalChars 超 1.2×limit 才 join+截断一次,平摊 O(limit)。
 * host 保留事件发布与活动守望接线(appendOutput 薄壳),本模块只管存储。
 */

import { sliceStreamTail } from "./streamSlice";

/** 共享 TextEncoder:逐 chunk 累计 UTF-8 字节数(TextEncoder 无线程语义,复用安全)。 */
const outputByteEncoder = new TextEncoder();

/** 输出缓冲的分块结构:chunks 按到达顺序排列,totalChars/totalBytes 为增量维护的合计。 */
interface OutputBuffer {
  chunks: string[];
  totalChars: number;
  totalBytes: number;
}

export class OutputBufferStore {
  private readonly buffers = new Map<string, OutputBuffer>();

  /** 追加一块输出,返回该 chunk 的 UTF-8 字节数(供 askWatch 漂移计量);
      totalChars 超 1.2×limit 时合并截断到尾部。 */
  append(sessionId: string, text: string, limit: number): number {
    const buf: OutputBuffer = this.buffers.get(sessionId) ?? {
      chunks: [],
      totalChars: 0,
      totalBytes: 0,
    };
    buf.chunks.push(text);
    buf.totalChars += text.length;
    /* 逐 chunk 编码累计字节数:PTY 侧按完整码点切包(decode_utf8_chunk 暂存尾部),
       chunk 边界永不劈开 surrogate pair,故分块编码之和 === 拼接后整段编码 */
    const chunkBytes = outputByteEncoder.encode(text).length;
    buf.totalBytes += chunkBytes;
    /* 1.2× 迟滞:只有明显超限才合并截断,避免每次 append 都做 O(limit) 拼接 */
    if (buf.totalChars > limit * 1.2) {
      const trimmed = sliceStreamTail(buf.chunks.join(""), limit);
      buf.chunks = [trimmed];
      buf.totalChars = trimmed.length;
      buf.totalBytes = outputByteEncoder.encode(trimmed).length;
    }
    this.buffers.set(sessionId, buf);
    return chunkBytes;
  }

  /** 会话至今的全部（尾部）输出，供 xterm 重挂载回放。join 后顺手压实为单 chunk。 */
  get(sessionId: string): string {
    const buf = this.buffers.get(sessionId);
    if (!buf) return "";
    if (buf.chunks.length === 1) return buf.chunks[0];
    const joined = buf.chunks.join("");
    buf.chunks = [joined]; // 回放即压实:后续 append 继续在单块上增长
    return joined;
  }

  /** 缓冲的 UTF-8 字节数(增量维护,O(1) 读取)。 */
  getBytes(sessionId: string): number {
    return this.buffers.get(sessionId)?.totalBytes ?? 0;
  }

  /** 会话移除:缓冲一并清除。 */
  remove(sessionId: string): void {
    this.buffers.delete(sessionId);
  }
}
