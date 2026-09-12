/**
 * omp 供应商认证 UI catalog —— 对齐 omp(oh-my-pi fork)的 provider 注册表
 * (先例:codemoss piFamilyAuthCatalog / pi v0.84.3 env map;omp 专属知识,留本插件)。
 *
 * 凭据存储 = ~/.omp/agent/agent.db 的 auth_credentials 表(provider / credential_type / data);
 * OAuth 登录 = `omp auth-broker login <loginArg>`(普通交互命令,经内置终端驱动)。
 * 品牌 logo = @lobehub/icons-static-svg 静态资产(vite 按 import 打包,零运行时);
 * icon=null 的走首字母兜底头像。google-vertex 走 ADC 服务账号,沿 codemoss 先例不收录。
 */

import anthropicIcon from "@lobehub/icons-static-svg/icons/anthropic.svg";
import azureaiIcon from "@lobehub/icons-static-svg/icons/azureai-color.svg";
import basetenIcon from "@lobehub/icons-static-svg/icons/baseten.svg";
import bedrockIcon from "@lobehub/icons-static-svg/icons/bedrock-color.svg";
import cerebrasIcon from "@lobehub/icons-static-svg/icons/cerebras-color.svg";
import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg";
import cloudflareIcon from "@lobehub/icons-static-svg/icons/cloudflare-color.svg";
import copilotIcon from "@lobehub/icons-static-svg/icons/copilot-color.svg";
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import fireworksIcon from "@lobehub/icons-static-svg/icons/fireworks-color.svg";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import groqIcon from "@lobehub/icons-static-svg/icons/groq.svg";
import huggingfaceIcon from "@lobehub/icons-static-svg/icons/huggingface-color.svg";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import mistralIcon from "@lobehub/icons-static-svg/icons/mistral-color.svg";
import nvidiaIcon from "@lobehub/icons-static-svg/icons/nvidia-color.svg";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import openrouterIcon from "@lobehub/icons-static-svg/icons/openrouter-color.svg";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import togetherIcon from "@lobehub/icons-static-svg/icons/together-color.svg";
import vercelIcon from "@lobehub/icons-static-svg/icons/vercel.svg";
import xaiIcon from "@lobehub/icons-static-svg/icons/xai.svg";
import xiaomimimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu-color.svg";

/** 订阅授权行(OAuth,由 omp CLI 自管;statusIds = 凭据表里代表「已授权」的 provider id)。 */
export interface OmpOauthProvider {
  id: string;
  name: string;
  icon: string | null;
  /** `omp auth-broker login <loginArg>` 的参数。 */
  loginArg: string;
  statusIds: readonly string[];
  desc: string;
}

export const OMP_OAUTH_PROVIDERS: readonly OmpOauthProvider[] = [
  { id: "anthropic", name: "Claude Pro / Max", icon: claudeIcon, loginArg: "anthropic", statusIds: ["anthropic"], desc: "Claude Pro / Max 订阅" },
  { id: "openai-codex", name: "ChatGPT Plus / Pro (Codex)", icon: openaiIcon, loginArg: "openai-codex", statusIds: ["openai-codex"], desc: "ChatGPT Plus / Pro 订阅" },
  { id: "github-copilot", name: "GitHub Copilot", icon: copilotIcon, loginArg: "github-copilot", statusIds: ["github-copilot"], desc: "GitHub Copilot 订阅" },
  { id: "xai-oauth", name: "xAI (Grok / X)", icon: xaiIcon, loginArg: "xai-oauth", statusIds: ["xai-oauth", "xai"], desc: "SuperGrok / X Premium+ 订阅" },
  { id: "openrouter", name: "OpenRouter", icon: openrouterIcon, loginArg: "openrouter", statusIds: ["openrouter"], desc: "OpenRouter 账号授权" },
  { id: "kimi-code", name: "Kimi Code", icon: kimiIcon, loginArg: "kimi-code", statusIds: ["kimi-code"], desc: "Kimi Code 订阅" },
  { id: "zai", name: "Z.AI (GLM Coding Plan)", icon: zhipuIcon, loginArg: "zai", statusIds: ["zai", "zai-coding-plan"], desc: "Z.AI (GLM Coding Plan) 订阅" },
  { id: "google-gemini-cli", name: "Google Code Assist (Gemini CLI)", icon: geminiIcon, loginArg: "google-gemini-cli", statusIds: ["google-gemini-cli"], desc: "Google Code Assist 授权" },
];

/** API Key 行(env_var = CLI 无存储凭据时的环境变量兜底;github-copilot OAuth-only 不列)。 */
export interface OmpApiKeyProvider {
  id: string;
  name: string;
  icon: string | null;
  envVar: string;
  /** 默认展示(true)或折进「显示全部」(false)。 */
  featured: boolean;
}

export const OMP_APIKEY_PROVIDERS: readonly OmpApiKeyProvider[] = [
  { id: "anthropic", name: "Anthropic", icon: anthropicIcon, envVar: "ANTHROPIC_API_KEY", featured: true },
  { id: "openai", name: "OpenAI", icon: openaiIcon, envVar: "OPENAI_API_KEY", featured: true },
  { id: "google", name: "Google Gemini", icon: geminiIcon, envVar: "GEMINI_API_KEY", featured: true },
  { id: "deepseek", name: "DeepSeek", icon: deepseekIcon, envVar: "DEEPSEEK_API_KEY", featured: true },
  { id: "xai", name: "xAI", icon: xaiIcon, envVar: "XAI_API_KEY", featured: true },
  { id: "openrouter", name: "OpenRouter", icon: openrouterIcon, envVar: "OPENROUTER_API_KEY", featured: true },
  { id: "groq", name: "Groq", icon: groqIcon, envVar: "GROQ_API_KEY", featured: true },
  { id: "mistral", name: "Mistral", icon: mistralIcon, envVar: "MISTRAL_API_KEY", featured: true },
  { id: "zai", name: "ZAI Coding Plan", icon: zhipuIcon, envVar: "ZAI_API_KEY", featured: true },
  { id: "kimi-coding", name: "Kimi For Coding", icon: kimiIcon, envVar: "KIMI_API_KEY", featured: true },
  { id: "qwen-token-plan", name: "Qwen Token Plan", icon: qwenIcon, envVar: "QWEN_TOKEN_PLAN_API_KEY", featured: true },
  { id: "minimax", name: "MiniMax", icon: minimaxIcon, envVar: "MINIMAX_API_KEY", featured: true },
  { id: "together", name: "Together AI", icon: togetherIcon, envVar: "TOGETHER_API_KEY", featured: true },
  { id: "fireworks", name: "Fireworks", icon: fireworksIcon, envVar: "FIREWORKS_API_KEY", featured: true },
  { id: "cerebras", name: "Cerebras", icon: cerebrasIcon, envVar: "CEREBRAS_API_KEY", featured: true },
  { id: "amazon-bedrock", name: "Amazon Bedrock", icon: bedrockIcon, envVar: "AWS_BEARER_TOKEN_BEDROCK", featured: true },
  { id: "moonshotai", name: "Moonshot AI", icon: null, envVar: "MOONSHOT_API_KEY", featured: false },
  { id: "moonshotai-cn", name: "Moonshot AI (China)", icon: null, envVar: "MOONSHOT_API_KEY", featured: false },
  { id: "ant-ling", name: "Ant Ling", icon: null, envVar: "ANT_LING_API_KEY", featured: false },
  { id: "azure-openai-responses", name: "Azure OpenAI Responses", icon: azureaiIcon, envVar: "AZURE_OPENAI_API_KEY", featured: false },
  { id: "nvidia", name: "NVIDIA NIM", icon: nvidiaIcon, envVar: "NVIDIA_API_KEY", featured: false },
  { id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway", icon: cloudflareIcon, envVar: "CLOUDFLARE_API_KEY", featured: false },
  { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI", icon: cloudflareIcon, envVar: "CLOUDFLARE_API_KEY", featured: false },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", icon: vercelIcon, envVar: "AI_GATEWAY_API_KEY", featured: false },
  { id: "zai-coding-cn", name: "ZAI Coding Plan (China)", icon: zhipuIcon, envVar: "ZAI_CODING_CN_API_KEY", featured: false },
  { id: "opencode", name: "OpenCode Zen", icon: opencodeIcon, envVar: "OPENCODE_API_KEY", featured: false },
  { id: "opencode-go", name: "OpenCode Go", icon: opencodeIcon, envVar: "OPENCODE_API_KEY", featured: false },
  { id: "radius", name: "Radius", icon: null, envVar: "RADIUS_API_KEY", featured: false },
  { id: "huggingface", name: "Hugging Face", icon: huggingfaceIcon, envVar: "HF_TOKEN", featured: false },
  { id: "baseten", name: "Baseten", icon: basetenIcon, envVar: "BASETEN_API_KEY", featured: false },
  { id: "minimax-cn", name: "MiniMax (China)", icon: minimaxIcon, envVar: "MINIMAX_CN_API_KEY", featured: false },
  { id: "qwen-token-plan-individual", name: "Qwen Token Plan (Individual)", icon: qwenIcon, envVar: "QWEN_TOKEN_PLAN_API_KEY", featured: false },
  { id: "qwen-token-plan-cn", name: "Qwen Token Plan (China)", icon: qwenIcon, envVar: "QWEN_TOKEN_PLAN_CN_API_KEY", featured: false },
  { id: "xiaomi", name: "Xiaomi MiMo", icon: xiaomimimoIcon, envVar: "XIAOMI_API_KEY", featured: false },
  { id: "xiaomi-token-plan-cn", name: "Xiaomi MiMo Token Plan (China)", icon: xiaomimimoIcon, envVar: "XIAOMI_TOKEN_PLAN_CN_API_KEY", featured: false },
  { id: "xiaomi-token-plan-ams", name: "Xiaomi MiMo Token Plan (Amsterdam)", icon: xiaomimimoIcon, envVar: "XIAOMI_TOKEN_PLAN_AMS_API_KEY", featured: false },
  { id: "xiaomi-token-plan-sgp", name: "Xiaomi MiMo Token Plan (Singapore)", icon: xiaomimimoIcon, envVar: "XIAOMI_TOKEN_PLAN_SGP_API_KEY", featured: false },
];

import { host } from "@kernel/host";
import { closeSettingsPanel } from "@kernel/settings";

/** 登录:打入登录命令到内置终端并关设置面板让用户看见流程。
 *  沿头部终端按钮同款语义:聚焦最新 shell 会话,无则新建 —— 复用已有 zsh 既少开
 *  会话,又绕开「新建装配竞态」(守卫偶发误报秒退)导致的整次登录失败。 */
export async function launchLogin(p: OmpOauthProvider): Promise<void> {
  const latest = host
    .getSessions()
    .filter((s) => s.kind === "shell")
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  const meta = latest ? latest : await host.createShellSession();
  host.setActiveSession(meta.id);
  host.writeSession(meta.id, `omp auth-broker login ${p.loginArg}\r`);
  closeSettingsPanel();
}
