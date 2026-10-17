import { beforeEach, describe, expect, it } from "vitest";
import {
  add,
  lineHash,
  ls,
  noteKey,
  remove,
  sessionKeyOf,
  setNoteStorageForTest,
  toggleSent,
} from "./diffNotes";

/** localStorage 内存替身(setNoteStorageForTest 注入)。 */
function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

beforeEach(() => setNoteStorageForTest(memoryStorage()));

describe("lineHash", () => {
  it("trimmed 内容定锚:首尾空白不影响,内容变则哈希变", () => {
    expect(lineHash("  const x = 1;  ")).toBe(lineHash("const x = 1;"));
    expect(lineHash("const x = 1;")).not.toBe(lineHash("const x = 2;"));
  });

  it("djb2 已知向量:空串 = 5381(0x1505)", () => {
    expect(lineHash("")).toBe("00001505");
  });
});

describe("sessionKeyOf", () => {
  it("有激活会话用会话 id,无会话回落 ws:<root>", () => {
    expect(sessionKeyOf("sess-1", "/repo")).toBe("sess-1");
    expect(sessionKeyOf(null, "/repo")).toBe("ws:/repo");
  });
});

describe("add / ls / toggleSent / remove", () => {
  it("add 落组且 ls 可读;sent 标记单向置位", () => {
    const n = add("s1", "a.ts", lineHash("foo()"), 12, "这里命名不对", "foo()");
    expect(ls("s1")).toHaveLength(1);
    toggleSent("s1", n.id);
    expect(ls("s1")[0]?.sent).toBe(true);
    toggleSent("s1", n.id); // 重复置位无害
    expect(ls("s1")[0]?.sent).toBe(true);
  });

  it("remove 删条目,空组回收", () => {
    const n = add("s1", "a.ts", lineHash("x"), 1, "t", "x");
    remove("s1", n.id);
    expect(ls("s1")).toHaveLength(0);
  });

  it("会话间隔离", () => {
    add("s1", "a.ts", lineHash("x"), 1, "t", "x");
    expect(ls("s2")).toHaveLength(0);
  });

  it("excerpt 随条目保留(回传拼 excerpt 用)", () => {
    const n = add("s1", "a.ts", lineHash("x"), 3, "t", "let x");
    expect(n.excerpt).toBe("let x");
  });
});

describe("LRU 剪除", () => {
  it("超过 40 会话剪最旧;最近访问的组存活", () => {
    for (let i = 0; i < 40; i++) add(`old-${i}`, "a.ts", "h", 1, "t", "x");
    expect(ls("old-0")).toHaveLength(1); // touch:old-0 移到最新
    for (let i = 40; i < 45; i++) add(`new-${i}`, "a.ts", "h", 1, "t", "x");
    expect(ls("old-0")).toHaveLength(1); // 刚 touch 过,存活
    expect(ls("old-1")).toHaveLength(0); // 最旧被剪
  });
});

describe("noteKey", () => {
  it("文件 + 行哈希 组合键", () => {
    expect(noteKey("a.ts", "abcd1234")).toBe("a.ts#abcd1234");
  });
});
