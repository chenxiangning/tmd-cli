#!/usr/bin/env node
/**
 * macOS 打包入口：`npm run build:mac-arm64 -- [--skip-sign] [--skip-notarize]`
 *
 * 参数映射（Tauri CLI 无 --skip-sign/--skip-notarize 原生旗标）：
 * - --skip-sign     → tauri build --no-sign（跳过代码签名）
 * - --skip-notarize → 清空 Apple 公证凭据环境变量（无凭据时 Tauri 默认即跳过公证）
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const target = process.argv[2];
if (!target || target.startsWith('--')) {
	console.error('用法: node scripts/build-mac.mjs <target-triple> [--skip-sign] [--skip-notarize]');
	process.exit(1);
}

const userArgs = process.argv.slice(3);
const skipSign = userArgs.includes('--skip-sign');
const skipNotarize = userArgs.includes('--skip-notarize');
const forwardArgs = userArgs.filter((arg) => arg !== '--skip-sign' && arg !== '--skip-notarize');

const tauriArgs = ['build', '--target', target, '--ci'];
if (skipSign) tauriArgs.push('--no-sign');
tauriArgs.push(...forwardArgs);

const env = { ...process.env };
if (skipNotarize) {
	// Tauri 仅在这些凭据存在时才触发 notarize;清空即等价于 --skip-notarize
	for (const key of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH']) {
		delete env[key];
	}
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriBin = path.join(root, 'node_modules', '.bin', 'tauri');

console.log(`[build-mac] target=${target} sign=${skipSign ? 'skip' : 'auto'} notarize=${skipNotarize ? 'skip' : 'auto'}`);
console.log(`[build-mac] tauri ${tauriArgs.join(' ')}`);

const result = spawnSync(tauriBin, tauriArgs, { cwd: root, env, stdio: 'inherit' });
if (result.error) {
	console.error(`[build-mac] 启动 tauri CLI 失败: ${result.error.message}`);
	process.exit(1);
}
process.exit(result.status ?? 1);
