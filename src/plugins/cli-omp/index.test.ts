/**
 * omp profile 注册契约测试 —— 守护 composer 发送通路的关键声明。
 *
 * bracketedPaste 一旦被摘(或后续 pi-tui 系 CLI 漏声明),composer 整串
 * 正文+CR 同帧到达会被编辑器的"粘贴爆发"启发式吞掉提交回车,表现为
 * "composer 发了但幕布没提交,须再手按回车"(win 实测,见 kernel/cliProfile.ts)。
 * 钉死 omp 与 pi/kimi 同阵营声明。
 */
import { describe, expect, it } from "vitest";
import { cliOmpPlugin } from "./index";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";

function activateCapturingProfile(): CliProfile {
  const captured: CliProfile[] = [];
  const teardown = cliOmpPlugin.activate({
    registerCliProfile: (profile: CliProfile) => captured.push(profile),
    registerMarketPanel: () => {},
    registerCliConfig: () => {},
  } as unknown as PluginContext);
  /* activate 现返回清理函数(预热管理器清场):立即执行,不留后台定时器。 */
  if (typeof teardown === "function") teardown();
  const profile = captured[0];
  if (!profile) throw new Error("activate 未注册任何 profile");
  return profile;
}

describe("cli-omp profile 注册契约", () => {
  it("id 为 omp 且必须声明 bracketedPaste(粘贴爆发吞回车的修复线)", () => {
    const profile = activateCapturingProfile();
    expect(profile.id).toBe("omp");
    expect(profile.bracketedPaste).toBe(true);
  });

  it("安装通道 = bun 全局安装,且声明 bun 前置依赖(welcome 门控数据源)", () => {
    const profile = activateCapturingProfile();
    /* omp 官方推荐 bun install -g;若通道回退 npm,bun 前置依赖即形同虚设。 */
    expect(profile.commandInstall).toEqual({
      program: "bun",
      args: ["install", "-g", "@oh-my-pi/pi-coding-agent"],
    });
    expect(profile.requires).toMatchObject({ binary: "bun", name: "Bun" });
    /* 依赖自身的安装通道 = bun 官方脚本(unix/Windows 双侧都要声明)。 */
    expect(profile.requires?.scriptInstall?.unix).toContain("bun.sh/install");
    expect(profile.requires?.scriptInstall?.windows).toContain("install.ps1");
    /* npmPackage 保留:registry 最新版查询仍要走它。 */
    expect(profile.npmPackage).toBe("@oh-my-pi/pi-coding-agent");
  });

  it("activity marks 契约(2026-09-25 omp 18.3 实证):busy 锚 braille 族,空闲时钟/mc 行不误匹配,idleMarks 退场", () => {
    const profile = activateCapturingProfile();
    const hit = (text: string) =>
      profile.busyMarks?.some((re) => text.split(/\r\n|\r|\n/).some((l) => re.test(l))) ?? false;

    /* 工作页脚两代形态都命中:v18.1/18.2「⠙ 9s · 模型」与 v18.3「⠧ 1m > ◉ …」。 */
    expect(hit("⠙ 9s · 模型 GLM")).toBe(true);
    expect(hit(" ⠧ 1m > ◉ GLM-5.3-Flash > 📁 …-cli ▶─5%─┃1M─")).toBe(true);
    expect(hit(" ⎋ 读探针命中与前缀识别实现")).toBe(true);

    /* v18.3.1 空闲时钟页脚与 mc 行(「idle」指 context 子系统)不得命中 ——
       裸 elapsed 匹配曾把完工后的空闲屏当在途自证(结算拖到分钟级)。 */
    expect(hit(" ⏺ 3m > ◉ GLM-5.3-Flash > 📁 …-cli ▶─5%─┃1M─")).toBe(false);
    expect(hit("mc: 50.4K (6%) · idle")).toBe(false);
    expect(hit("π › 🐴 ponytail: ⚡ FULL")).toBe(false);

    /* 18.3 把 mc 行常驻画进工作屏(2110/2110 帧落在工作期),空闲自证字面量
       已无独占形态 —— idleMarks 退场,完工收口走 busyHoldMs 尾窗。 */
    expect(profile.idleMarks).toBeUndefined();
    /* exec 期渲染冻结 ~60s(分钟跳格),默认 30s 自证窗必假结算且 I2 拦死。 */
    expect(profile.busyHoldMs).toBe(75_000);
  });
});
