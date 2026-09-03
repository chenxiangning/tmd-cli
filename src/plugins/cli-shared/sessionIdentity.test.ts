/**
 * 会话文件身份自证解析的契约测试。输入行型全部实证自本机磁盘(2026-09-03):
 * - omp/pi:首行 {"type":"session","version":3,"id","timestamp","cwd"};
 * - claude/qoder:行内 "sessionId" + 消息行 "cwd"/"timestamp" 字段。
 */
import { describe, expect, it } from "vitest";
import {
  parseClaudeFamilySessionHead,
  parsePiFamilySessionHead,
} from "./sessionIdentity";

describe("parsePiFamilySessionHead(omp/pi)", () => {
  it("实证首行 → id/cwd/createdAt", () => {
    const head = [
      '{"type":"session","version":3,"id":"01a06638-0e9b-76c3-ae48-080ffca032d3","timestamp":"2026-09-03T07:42:24.923Z","cwd":"/Users/x/repo","title":"t","titleSource":"auto"}',
      '{"type":"model_change","id":"babf323d","parentId":null,"timestamp":"2026-09-03T07:42:24.956Z","model":"kimi-code/k3"}',
    ].join("\n");
    expect(parsePiFamilySessionHead(head)).toEqual({
      id: "01a06638-0e9b-76c3-ae48-080ffca032d3",
      cwd: "/Users/x/repo",
      createdAt: Date.parse("2026-09-03T07:42:24.923Z"),
    });
  });

  it("对话内容里的 type=session 误匹配行不采纳(只认首行帧型)", () => {
    const head = [
      '{"type":"message","message":{"role":"assistant","content":"see \\"type\\":\\"session\\" inside"}}',
      '{"type":"session","id":"real-id","cwd":"/repo","timestamp":"2026-09-03T07:00:00Z"}',
    ].join("\n");
    expect(parsePiFamilySessionHead(head)?.id).toBe("real-id");
  });

  it("缺 session 行(截断/老格式)= null", () => {
    expect(parsePiFamilySessionHead('{"type":"message"}')).toBeNull();
    expect(parsePiFamilySessionHead("")).toBeNull();
  });
});

describe("parseClaudeFamilySessionHead(claude/qoder)", () => {
  it("实证行型:mode 行 sessionId + user 行 cwd/timestamp", () => {
    const head = [
      '{"type":"mode","mode":"normal","sessionId":"605163bf-8c53-4acf-8ed7-66ae1aee01dd"}',
      '{"type":"file-history-snapshot","snapshot":{"timestamp":"2026-09-01T21:12:14.933Z"}}',
      '{"parentUuid":null,"type":"user","cwd":"/Users/x/.tmd-cli/default","sessionId":"605163bf-8c53-4acf-8ed7-66ae1aee01dd","timestamp":"2026-09-01T21:12:14.940Z","message":{"role":"user","content":"hi"}}',
    ].join("\n");
    expect(parseClaudeFamilySessionHead(head)).toEqual({
      id: "605163bf-8c53-4acf-8ed7-66ae1aee01dd",
      cwd: "/Users/x/.tmd-cli/default",
      createdAt: Date.parse("2026-09-01T21:12:14.933Z"),
    });
  });

  it("head 内无 sessionId = null", () => {
    expect(parseClaudeFamilySessionHead('{"type":"summary","summary":"s"}')).toBeNull();
  });
});
