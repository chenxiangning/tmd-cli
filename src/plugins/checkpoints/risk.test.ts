import { describe, expect, it } from "vitest";
import { classifyRisk } from "./risk";

describe("classifyRisk", () => {
  it("凭据/Shell 配置/CI/服务定义 = high", () => {
    expect(classifyRisk(".env")).toBe("high");
    expect(classifyRisk("config/.env.production")).toBe("high");
    expect(classifyRisk("deploy/server.pem")).toBe("high");
    expect(classifyRisk(".ssh/config")).toBe("high");
    expect(classifyRisk("keys/id_ed25519")).toBe("high");
    expect(classifyRisk(".github/workflows/ci.yml")).toBe("high");
    expect(classifyRisk("deploy/app.service")).toBe("high");
    expect(classifyRisk("LaunchAgents/com.x.plist")).toBe("high");
    expect(classifyRisk(".gitconfig")).toBe("high");
  });

  it("普通业务文件 = normal(不含误伤面)", () => {
    expect(classifyRisk("src/main.rs")).toBe("normal");
    expect(classifyRisk("src/kernel/settings.ts")).toBe("normal");
    expect(classifyRisk("docs/README.md")).toBe("normal");
    expect(classifyRisk("environments/list.ts")).toBe("normal"); // 目录名带 env 不误伤
    expect(classifyRisk("src/service.ts")).toBe("normal");
  });

  it("反斜杠/盘符形态与正斜杠同判(匹配前归一,三轮 R3-CKPT-04)", () => {
    expect(classifyRisk(".ssh\\config")).toBe("high");
    expect(classifyRisk("keys\\id_ed25519")).toBe("high");
    expect(classifyRisk("C:\\repo\\.env")).toBe("high");
    expect(classifyRisk("C:\\repo\\src\\main.rs")).toBe("normal");
  });
});
