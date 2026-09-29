/**
 * dsh 转录行型测试 —— 侊本取自本机 ~/.dsh/sessions zstd 解压后真实行(2026-09-28):
 * user/message(source.kind 门控)/assistant/message parts/tool-call/
 * tool/result 嵌套 content。
 */

import { describe, expect, it } from "vitest";
import { decompressZstdWithBudget, dshTranscriptLine } from "./dshTranscript";
import { pairToolResults, parseTranscriptBlocks } from "../cli-shared/sessionTranscript";

describe("dshTranscriptLine", () => {
  it("user/message source.kind=user → user 块;plugin 播报跳过", () => {
    const blocks = dshTranscriptLine({
      type: "user/message",
      seq: 15,
      time: 1787648514901,
      data: {
        content: [{ type: "text", text: "项目分析" }],
        source: { kind: "user", rpcId: "r1" },
        role: "user",
        id: "b14424cd",
      },
    });
    expect(blocks).toEqual([
      { id: "b14424cd", role: "user", text: "项目分析", startedAt: 1787648514901 },
    ]);
    expect(
      dshTranscriptLine({
        type: "user/message",
        data: { content: [{ type: "text", text: "审批策略已变更" }], source: { kind: "plugin", plugin: "user-approval" } },
      }),
    ).toEqual([]);
  });

  it("assistant/message parts:text → assistant;tool-call → tool 块;与 tool/result 配对", () => {
    const text = [
      JSON.stringify({
        type: "assistant/message",
        time: 2,
        data: {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I'll analyze the project." },
              { type: "tool-call", id: "call_1", name: "bash" },
            ],
          },
        },
      }),
      JSON.stringify({
        type: "tool/call",
        time: 3,
        data: { callId: "call_1", name: "bash", arguments: '{"command":"ls -la /"}' },
      }),
      JSON.stringify({
        type: "tool/result",
        time: 4,
        data: {
          message: {
            source: { kind: "tool", callId: "call_1" },
            content: [
              {
                type: "tool-result",
                toolCallId: "call_1",
                content: [{ type: "text", text: "bin etc" }],
              },
            ],
          },
        },
      }),
    ].join("\n");
    const blocks = pairToolResults(parseTranscriptBlocks(text, dshTranscriptLine));
    /* tool-call part 块(无 arguments → 无 shell 预览)与 tool/call 块同 callId:
       先到的 part 块被 tool/call 块顶替配对,assistant 文本块 + 合并工具块。 */
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ role: "assistant", text: "I'll analyze the project." });
    const done = blocks.find((b) => b.role === "tool" && b.tool?.status === "done");
    expect(done?.tool).toMatchObject({ callId: "call_1", title: "bash", detail: "bin etc" });
  });
});

/** 4000 行重复 JSON(222,889B)的 zstd -3 帧(4,007B),base64 内嵌:
 *  fzstd 0.1.x 只有解压没有压缩,离线 zstd 生成一次性定格(可移植零依赖)。 */
const PACKED_ZSTD_B64 = "KLUv/aSpZgMAnE8ACqeQEhmQNclwuIw3/h1RQfw/RyKllDKl9IJ41xTgNQEaASABVVVVREREREQzMzMzMyIiIiIiERERERH///+/bdu23bZt25IkSZKLxWKxWCwWi0VVVVVVFRERERHRzMzMzIyIiIiISERERETE////b9u2bbdt27YkSZLkvu/7vu/7vldVVVVVERERERHNzMzMzIiIiIiIRERERET8////tm3bdtu2bUuSJEnO8zzP8zzPc1VVVVUVEREREdHMzMzMjIiIiIhIRERERMT///9v27Ztt23btiRJkuS6ruu6ruu6VlVVVVUREREREc3MzMzMiIiIiIhERERERPz///+2bdt227ZtS5IkyW3bto1VVVVVVUREREREMzMzMzMiIiIiIhERERER////v23btt22bduSJEmyaCTuMkAAA4KBMAwQYDAUjDAYKBwYCobCQQECA2EoGCQ4GAAIJEmSJEmSJEmS4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziO4ziOVVVVVVVERERERDMzMzMzIiIiIiIREREREf///79t27bdtm3bkiRJkqvVarVarVarVVVVVVUVEREREdHMzMzMjIiIiIhIRERERMT///9v27Ztt23btiRJkuRoNBqNRqPRaFRVVVVVRUREREQ0MzMzMyMiIiIiEhERERHx////27Zt223bti1JkiS52Ww2m81ms9lUVVVVVRERERERzczMzMyIiIiIiERERERE/P///7Zt23bbtm1LkiRJTiaTyWQymUwmVVUBMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERH/////////////////////////////////////////////////b9u2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdtt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27ZtS5IkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIBtm3btm3btm3btm3btm3btm3btm3btt22bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2JEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJLmu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu61pVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVRUREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREQ0MzMzE4k5qARAeE//BzMfA6GkBxTgfwAEAECA/+c/JEkiSSKRTJIkkkkkySRJTpJMkkwmySTJJJlJkkySnCSZJMkkkkmSSRKZJJkkOUmSSZJJJJMkmWQySTJJkpMkkySTSTJJMklikiSTJCVJJkkyk2SSZJJEJkkmSU6SZJJkMskkSSaZTJKYJMuNlt28jvO4bts0GWb7vI7rNi7Dfp/t8zqu27gM+3y2z+u4buMy7PvZPq/juo3LsO9r+7yO6zYuw76v7fM6rtu4DPs+m8/ruG7jMuz7DEkiSSKZJJJkkiQkSSJJZpJEkiSSySRJJMlEkkySRCJJJMkkkUiSRJKZJIkkSUSSSZJIJokkmSQZSZJIkhlJIkkSSWSSJJIkIkkmSWKSJJJkkkgkSSLJTJJEkiQmySRJJJNEkkyShCRJJMlEkkiSRCaZJIkkiUiSSZKYJIkkmWQSSZJIMpMkkSSJSDJJEkkkkSSTZCJJEkkykSSSJJFJJkkiSSaSpCRJTJJEkkwSiSRJJIlJkkiSjCSZJIkkkkiSSTKRJIkkmUkSSZLIJJMkkSQRSTJJEpEkkSSTSSJJEklikiSSJCNJJkkimSSSZJJMJEkiSSaSRJIkEskkSSSZRJJMkkQkSSTJZJJIkkSSMUkSSZKRJJMkkUQSSTJJIpIkkSQnSSJJEolkkiSSTCJJJklikiSSZDJJJEkiSUySRJIkJMkkSWSSRJJMkogkSSTJSZJIkkQmmSSJJJNIkkmSiCSJJJlEEkmSSCaTJJEkCUmuOV4CEy//wmvZwOu+7yLPu1DXXcxxl+62yzftWlx2XYZdhF0X+qyLv+rSbNTl33QtT7quiy7ioAt1z8Wbc2muuTxjroUt133KRV9yIRty8Xdc2jMu74prccR13XDRJlyICy7OgEtjv+Wfb62vt87GW/TtFvJ0i7vc0hxueXdba7Ot42qLMtpC2GzxJ1v6iy23wdb6Xus816KutRDHWtytlt5Uy7nUWhlqHXZa9JkW+kqLbaSlv9FyT7RWF1rHgRZ1n4U2z2Kus3TGWY5t1vo0677MIhtmoe+y2LMs3VWWc5S1usm6TbKIiyyUQRZjj6U/x/KvsZaNse5bLPIUC3WJxRxi6e6wfDOsxRXWZYRF2GChT7D4CyxtAyxts2272zbbtrttu22zzXbbttt2tm23bbvbZtt22223bbZtbttWqy6rmlCSFNG2zXabbdttm9223bbdbdtt222327bdtrttu22bs223bbfZdtswKXpVL6uaKO22zWzbbttut922zbadbZtt29623bbZZttt220z27bdtr1tsw2jJCkCuayK0mbbbrZttm1223bbZrvNtm23zWzbbNvmts22zXbbbttsm9m27baKqk5UBF0XbZvtNtu22Xa7bWbbNrZtt20222bbdtvNtm22bW7bbNtmt+22jXNZVcqiqmmSbdvbttm22WyzbdttNts227a7bbNts9m22zbbbrZtu21r22bbPikKuayKsijNttlu227b3Lbttu1u223bbrPdtt223W3bbdvttt223dZ227bbRkmmSYpOVqVtZttu22677bbtts1t227b7rbdtu22223bbdvdtt223WzbbdttloqqJiqCrtp2t22zbTPbZtu22222bbZtd9tm22a3bbdtttls23bbzLbNNk9US2FrUqSEQUMY3sHoGYxfwawRzG1gaAKDFjDcAQyppJIkkiQqSSpJqpKkkkgkkUqSVJKIJKkkSUuSSJJKIkmlPljIg4U6WIiDhTZYkAYLZbAQBgthumBxFpJkkkTZT2vcv///N/QPDS0Aymx8CwrApQPJbkqN/10JpAC4AM4Abdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bduWJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJLdt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27ZNkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkpIkSZIkSZIkSZIkSZIkSQIAAAAAAAAAAAAAAAAAAAAAAABAJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJ/P///////////////////////////////////////////////79t27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Ztt20D27Zt27Zt27Zt27Zt27Zt27Zt27Zt27ZtkyRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkqQkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkCSGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACD/////////////////////////////////////////////////b9u2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdtt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27ZtS5IkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZLbtm3btm3btm3btm3bAoZomBOA/AcAE/D/fwIB338kSZIkkSRJkmSSJEmSSZIkSTJJkiRJJEmSJIkkSZIkkyRJkkySJEmSSZIkSSJJkiRJSJIkSTJJkiTJJEmSJJkkSZIkkiRJkkSSJEmSSZIkSSZJkiTJJEmSJJEkSZIkkiRJkpwkSZJkkiRJkkySJEkSSZIkSSJJkiTJJEmSJJMkSZJkkiRJkkiSJEkSSZIkSSZJkiSZSZIkSSZJkiSJJEmSJJEkSZJkkiRJkkmSJEkySZIkSSRJkiSJJEmSJJMkSZJMkiRJkpkkSZJEkiRJkkiSJEkySZIkySRJkiSZJEmSJJIkSZJEkiRJkkmSJEkmSZIkySRJkiSRSZIkSSRJkiSZJEmSZJIkSZJMkiRJEkmSJEkiSZIkySRJkiSTJEmSZJIkSZJIkiRJEpkkSZJMkiRJMkmSJEkmSZIkiSRJkiSRJEmSZJIkSZJJkiRJMkmSJEkkSZIkiSRJkiSTSTJJ28l0sT+br9ab7WS62J/NV+vNdjJd7M/mq/VmO5ku9mfz1XqznUwX+7P5ar3ZTqaL/dl8td5sJ9PF/my+Wm+2k+lifzZfrTfbyXSxP5uv1pvtZLrYn81XG0kySZIkSSRJMkkySZIkSSJJkiSJJEmSJJEkSZJMkiRJkkmSJEkiSZIkSSRJkiSZJEmSZJIkSZJMkiSTJJIkSZJEkiRJkkmSJEkmSZIkySRJkiSRJEmSJJIkSZJMkiRJMkmSJEkmSZIkiSRJMkkiSZIkySRJkiSTJEmSZJIkSZJIkiRJEkmSJEkmSZIkmSRJkiSTJEmSRJIkSZJIkiSTZJIkSZJJkiRJMkmSJEkkSZIkiSRJkiSTJEmSTJIkSZJJkiRJIkmSJEkkSZIkmSRJMskkSZIkmSRJkiSSJEmSRJIkSZJJkiRJJkmSJMkkSZIkkSRJkiSSJMlnx/bagIk=";

describe("decompressZstdWithBudget(解压预算闸)", () => {
  const packed = Uint8Array.from(atob(PACKED_ZSTD_B64), (c) => c.charCodeAt(0));
  const fullText = Array.from(
    { length: 4000 },
    (_, i) => `{"type":"note","seq":${i},"pad":"${"x".repeat(20)}"}`,
  ).join("\n");

  it("超预算截尾置 truncated,截在预算线且头部完整", () => {
    const over = decompressZstdWithBudget(packed, 10 * 1024);
    expect(over.truncated).toBe(true);
    expect(over.text.length).toBe(10 * 1024); /* ASCII 字节=字符,截在预算线 */
    expect(over.text.startsWith('{"type":"note","seq":0,')).toBe(true);
  });

  it("预算内整流往返无损(与 fzstd decompress 同构)", () => {
    const full = decompressZstdWithBudget(packed, 32 * 1024 * 1024);
    expect(full.truncated).toBe(false);
    expect(full.text).toBe(fullText);
  });
});
