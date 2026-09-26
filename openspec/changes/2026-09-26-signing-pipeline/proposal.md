# 签名/公证 CI 管道(macOS)与 Windows 决策项

> 日期:2026-09-26 · 状态:部分落地(macOS 管道就绪待 secrets;Windows 证书采购待拍板)
> 上游:能力盘点 `docs/research/client-capability-gap-analysis.md`(批次七/工程债;「首次打开需手动放行」是分发摩擦)

## 目标

macOS Gatekeeper 放行与 Windows SmartScreen 是增长摩擦。本变更给 release.yml 接上 macOS 代码签名 + 公证管道:**repo secrets 配齐即自动启用,不配则行为与旧构建完全一致**(零风险增量)。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| macOS | release.yml 构建步前注入 `APPLE_*` 六 env(secrets 缺失自动跳过),tauri bundler 原生走 codesign + notarytool | 证书/账号采购(Apple Developer $99/年,用户侧决策) |
| Windows | 决策项写入注释与本文档(OV/EV p12 或 Azure Trusted Signing,经 tauri `signCommand` 接线) | 盲接自签证书(SmartScreen 信誉照样拦,白花钱) |
| Android/iOS 壳 | 保持如实标注 unsigned(Android debug 签名 APK 直装可用) | 正式签名(需 keystore/账号,同属用户侧采购) |

## 大仙侧启用清单(macOS)

1. Apple Developer Program 账号($99/年)。
2. 创建 **Developer ID Application** 证书,导出 `.p12`:`base64 -i cert.p12 | pbcopy` → repo secret `APPLE_CERTIFICATE`;导出密码 → `APPLE_CERTIFICATE_PASSWORD`。
3. `APPLE_SIGNING_IDENTITY` = `Developer ID Application: <注册名>`;`APPLE_ID` = Apple ID 邮箱;`APPLE_PASSWORD` = App 专用密码(appleid.apple.com 生成);`APPLE_TEAM_ID` = 10 位 Team ID。
4. 推 v* tag → 构建日志应见 codesign/notarytool 段;产物 `spctl -a` 校验通过。

## 风险

| 风险 | 对策 |
|---|---|
| secrets 配错致构建红 | 注入步 fail 只在 secret 存在时发生;错误信息原样透出(notarytool 日志可查) |
| 公证超时/拒 | 公证在 bundler 内同步等待;拒绝原因 Apple 邮件 + 日志双通道 |

## 验证

- `python3 -c yaml.safe_load` release.yml 合法。
- 真实验证 = 配齐 secrets 后推 tag 跑一次 release(需大仙完成采购与 secrets 配置;未配前流水线行为与旧一致,已由条件逻辑保证)。
