/**
 * bash 写盘命令提取契约测试。命令文本实证自 2026-09-25 真实 omp 会话
 * (012210c 的批量替换现场),非构造格式;toolCall 形状 omp=bash / pi=ctx_shell。
 */
import { describe, expect, it } from "vitest";
import { bashToolCallEvents, bashWritePaths } from "./bashWrites";

const CWD = "/Users/x/code/AI/github/tmd-cli";

describe("bashWritePaths", () => {
  it("sd 双实参后全是文件(2026-09-25 真实命令)", () => {
    expect(
      bashWritePaths(
        "sd 'config_write_settings' 'config_merge_settings' src-tauri/src/web/conn_tests.rs src-tauri/src/web/web_access.rs",
      ),
    ).toEqual(["src-tauri/src/web/conn_tests.rs", "src-tauri/src/web/web_access.rs"]);
  });

  it("sd 双实参(stdin 态)与预览旗标不产生目标", () => {
    expect(bashWritePaths("sd 'a' 'b'")).toEqual([]);
    expect(bashWritePaths("sd -p 'a' 'b' f.ts")).toEqual([]);
  });

  it("perl -pi -e 组合旗标 + 链式 grep/echo 不污染(2026-09-25 真实命令)", () => {
    const cmd =
      "perl -pi -e 's/configWriteSettings/configMergeSettings/g' src/kernel/askSound.test.ts " +
      "src/plugins/workspace/groups.test.ts && grep -rn 'configWriteSettings' src/ || echo \"src 无残留\"";
    expect(bashWritePaths(cmd)).toEqual([
      "src/kernel/askSound.test.ts",
      "src/plugins/workspace/groups.test.ts",
    ]);
  });

  it("perl 无 -i 只写 stdout,不产生目标", () => {
    expect(bashWritePaths("perl -ne 'print if /x/' a.md")).toEqual([]);
  });

  it("perl -i.bak 附着后缀", () => {
    expect(bashWritePaths("perl -i.bak -pe 's/a/b/' docs/README.md")).toEqual(["docs/README.md"]);
  });

  it("sed GNU 附着后缀与 BSD 独立空后缀;无 -i 或 -e 表达式拒收", () => {
    expect(bashWritePaths("sed -i 's/a/b/' a.ts b.ts")).toEqual(["a.ts", "b.ts"]);
    expect(bashWritePaths("sed -i '' 's/a/b/' a.ts")).toEqual(["a.ts"]);
    expect(bashWritePaths("sed -n '1,20p' a.ts")).toEqual([]);
    expect(bashWritePaths("sed -e 's/a/b/' -i a.ts")).toEqual([]);
  });

  it("重定向与 tee;fd 复制与 /dev/* 不算", () => {
    expect(bashWritePaths("echo '{\"a\":1}' > src-tauri/tauri.conf.json")).toEqual([
      "src-tauri/tauri.conf.json",
    ]);
    expect(bashWritePaths("cat header.md >> docs/README.md")).toEqual(["docs/README.md"]);
    expect(bashWritePaths("pnpm build 2>/dev/null > out.log")).toEqual(["out.log"]);
    expect(bashWritePaths("pnpm build | tee build.log")).toEqual(["build.log"]);
    expect(bashWritePaths("cargo test > /dev/null 2>&1")).toEqual([]);
  });

  it("fd 定向 2> / 2>> 空格与粘连两形态都入账", () => {
    expect(bashWritePaths("pnpm build 2> err.log")).toEqual(["err.log"]);
    expect(bashWritePaths("pnpm build 2>err.log")).toEqual(["err.log"]);
    expect(bashWritePaths("tail -f app.log 2>>app.err")).toEqual(["app.err"]);
    expect(bashWritePaths("pnpm build > out.log 2> err.log")).toEqual(["out.log", "err.log"]);
  });

  it("引号内的分隔符不切段(管道在 perl 脚本里)", () => {
    expect(bashWritePaths("perl -pi -e 's/a|b/c/g' f.md")).toEqual(["f.md"]);
  });

  it("glob 与命令替换等残留元字符拒收(宁漏)", () => {
    expect(bashWritePaths("echo x > 'src/*.ts'")).toEqual([]);
    expect(bashWritePaths("echo x > $(mktemp)")).toEqual([]);
  });
});

describe("bashToolCallEvents", () => {
  const T = Date.parse("2026-09-25T14:36:11.921Z");

  const call = (name: string, command: string) => ({
    role: "assistant",
    content: [{ type: "toolCall", id: "c1", name, arguments: { command } }],
  });

  it("omp bash toolCall 逐文件出事件,时刻取条目 timestamp", () => {
    const events = bashToolCallEvents(call("bash", "sd 'a' 'b' src/x.ts src/y.ts"), T, CWD);
    expect(events.map((e) => e.path)).toEqual(["src/x.ts", "src/y.ts"]);
    expect(events.every((e) => e.ts === T)).toBe(true);
  });

  it("pi ctx_shell 同契约(实证形状,name=ctx_shell)", () => {
    const events = bashToolCallEvents(call("ctx_shell", "echo x > docs/a.md"), T, CWD);
    expect(events.map((e) => e.path)).toEqual(["docs/a.md"]);
  });

  it("非 shell 工具与无 command 实参不产生事件", () => {
    expect(bashToolCallEvents({ content: [{ type: "toolCall", name: "read", arguments: { path: "a.ts" } }] }, T, CWD)).toEqual([]);
    expect(bashToolCallEvents({ content: [{ type: "toolCall", name: "bash", arguments: {} }] }, T, CWD)).toEqual([]);
  });

  it("cwd 外路径原样上抛,逃逸路径拒收(与 edit 工具同闸)", () => {
    const ev = bashToolCallEvents(call("bash", "echo x > /tmp/gen_data.py"), T, CWD);
    expect(ev.map((e) => e.path)).toEqual(["/tmp/gen_data.py"]);
    expect(bashToolCallEvents(call("bash", "echo x > ../outside.ts"), T, CWD)).toEqual([]);
  });
});
