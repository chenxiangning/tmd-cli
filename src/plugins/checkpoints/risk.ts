/**
 * 审批文件危险度分层(纯函数,单测覆盖)—— 审批疲劳纵深:
 * 敏感路径(凭据/Shell 配置/CI/服务定义)命中即「高危」红标,提示细读 diff。
 * 规则刻意保守(宁漏勿扰):只收系统级/凭据面,普通业务配置不升险。
 */

const HIGH_RISK_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.ssh\//,
  /(^|\/)\.aws\//,
  /(^|\/)\.gnupg\//,
  /(^|\/)\.env(\.[^/]+)?$/,
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\..+)?$/,
  /(^|\/)(\.git-credentials|\.netrc|\.gitconfig)$/,
  /(^|\/)\.(zshrc|bashrc|bash_profile|profile)$/,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/,
  /(^|\/)Makefile$/,
  /\.service$/,
  /\.plist$/,
  /(^|\/)crontab$/,
];

/** 路径(仓库相对)→ 危险度。high = 建议细读 diff 再放行。 */
export function classifyRisk(path: string): "high" | "normal" {
  return HIGH_RISK_PATTERNS.some((re) => re.test(path)) ? "high" : "normal";
}
