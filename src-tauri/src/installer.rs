//! CLI 安装器 —— 一键安装各 AI CLI,stdout/stderr 逐行流式推前端。
//!
//! 设计决策(照抄 codemoss installer 的策略矩阵,但砍到只剩"安装最新版"):
//! - claude:官方 native 安装器(unix `curl -fsSL ... | bash`;Windows PowerShell irm|iex);
//! - codex/omp/pi/grok/qodercli/qoderclicn:npm 全局安装(`npm install -g <pkg>@latest`);
//! - 进度语义:npm/curl 都无离散百分比 → 前端用 indeterminate 进度条 + 本模块的流式日志。
//!
//! 事件协议(Tauri event,topic = `cli-install://{engine}`):
//! - `{ stream: "stdout"|"stderr", text }` 逐行日志;
//! - `{ stream: "phase", text: "start"|"done:ok"|"done:fail" }` 生命周期。
//!
//! 阻塞安全:全部子进程逻辑在 spawn_blocking 内执行(见 lib.rs command 包装),
//! 本模块函数均为同步阻塞,禁止直接在 Tauri 主线程调用。

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter};

use crate::resolve::enriched_path;

/// 安装超时(秒)。npm 全局安装在慢网络下分钟级;对齐 codemoss INSTALL_TIMEOUT_SECS。
const INSTALL_TIMEOUT_SECS: u64 = 300;

/// 安装引擎(前端按 camelCase 传: "claude" | "codex" | "omp" | "pi" | "kimi" | "grok" | "qodercli" | "qoderclicn")。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CliInstallEngine {
    Claude,
    Codex,
    Omp,
    Pi,
    Kimi,
    Grok,
    Qodercli,
    Qoderclicn,
}

impl CliInstallEngine {
    fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Omp => "omp",
            Self::Pi => "pi",
            Self::Kimi => "kimi",
            Self::Grok => "grok",
            Self::Qodercli => "qodercli",
            Self::Qoderclicn => "qoderclicn",
        }
    }
}

/// 推给前端的单行事件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallEvent {
    pub stream: String,
    pub text: String,
}

/// npm 全局安装的包名(@latest 钉最新版,对齐 codemoss package_name_for_engine)。
fn npm_package(engine: CliInstallEngine) -> &'static str {
    match engine {
        CliInstallEngine::Codex => "@openai/codex@latest",
        CliInstallEngine::Omp => "@oh-my-pi/pi-coding-agent@latest",
        CliInstallEngine::Pi => "@earendil-works/pi-coding-agent@latest",
        CliInstallEngine::Kimi => "@moonshot-ai/kimi-code@latest",
        CliInstallEngine::Grok => "@xai-official/grok@latest",
        CliInstallEngine::Qodercli => "@qoder-ai/qodercli@latest",
        CliInstallEngine::Qoderclicn => "@qodercn-ai/qoderclicn@latest",
        CliInstallEngine::Claude => unreachable!("claude 走官方 native 安装器"),
    }
}

/// 构造安装命令(program + args)。
/// claude unix:bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
/// claude windows:powershell -NoProfile -c 'irm https://claude.ai/install.ps1 | iex'
/// 其余:npm install -g <pkg>(Windows 经 cmd /c 跑 npm.cmd shim)。
fn install_command(engine: CliInstallEngine) -> (String, Vec<String>) {
    if engine == CliInstallEngine::Claude {
        #[cfg(windows)]
        return (
            "powershell".into(),
            vec![
                "-NoProfile".into(),
                "-Command".into(),
                "irm https://claude.ai/install.ps1 | iex".into(),
            ],
        );
        #[cfg(not(windows))]
        return (
            "bash".into(),
            vec![
                "-c".into(),
                "curl -fsSL https://claude.ai/install.sh | bash".into(),
            ],
        );
    }
    let pkg = npm_package(engine);
    #[cfg(windows)]
    return (
        "cmd".into(),
        vec![
            "/c".into(),
            "npm".into(),
            "install".into(),
            "-g".into(),
            pkg.into(),
        ],
    );
    #[cfg(not(windows))]
    (
        "npm".into(),
        vec!["install".into(), "-g".into(), pkg.into()],
    )
}

/// 执行安装:spawn → 双线程逐行泵 stdout/stderr → 事件流 → 等退出。
/// 返回 Ok(成功?) — exit code 0 = true。命令构建失败/超时返回 Err。
pub fn run_install(app: &AppHandle, engine: CliInstallEngine) -> Result<bool, String> {
    let topic = format!("cli-install://{}", engine.as_str());
    let emit = |stream: &str, text: String| {
        let _ = app.emit(
            &topic,
            CliInstallEvent {
                stream: stream.to_string(),
                text,
            },
        );
    };

    let (program, args) = install_command(engine);
    emit("phase", "start".into());
    emit("stdout", format!("$ {} {}", program, args.join(" ")));

    let mut cmd = Command::new(&program);
    cmd.args(&args);
    cmd.env("PATH", enriched_path());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    /* 防挂:子进程若继承 stdin 且安装脚本读输入,会永久等待。 */
    cmd.stdin(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("spawn {program}: {e}"))?;

    /* 双线程逐行泵:stdout/stderr 各一个,AppHandle clone 进线程(Send)。
    泛型 over Read:ChildStdout/ChildStderr 是不同类型,闭包无法复用。 */
    fn pump<R: std::io::Read + Send + 'static>(
        reader: Option<R>,
        stream: &'static str,
        app: &AppHandle,
        topic: &str,
    ) -> Option<thread::JoinHandle<()>> {
        reader.map(|r| {
            let app2 = app.clone();
            let topic2 = topic.to_string();
            thread::spawn(move || {
                for line in BufReader::new(r).lines() {
                    let Ok(text) = line else { break };
                    let _ = app2.emit(
                        &topic2,
                        CliInstallEvent {
                            stream: stream.to_string(),
                            text,
                        },
                    );
                }
            })
        })
    }
    let out_thread = pump(child.stdout.take(), "stdout", app, &topic);
    let err_thread = pump(child.stderr.take(), "stderr", app, &topic);

    let exit = crate::resolve::wait_child_with_timeout(
        &mut child,
        std::time::Duration::from_secs(INSTALL_TIMEOUT_SECS),
    );
    if let Some(t) = out_thread {
        let _ = t.join();
    }
    if let Some(t) = err_thread {
        let _ = t.join();
    }

    match exit {
        Some(Ok(status)) if status.success() => {
            emit("phase", "done:ok".into());
            Ok(true)
        }
        Some(Ok(status)) => {
            emit("phase", "done:fail".into());
            emit("stderr", format!("exit code: {}", status));
            Ok(false)
        }
        Some(Err(e)) => {
            emit("phase", "done:fail".into());
            Err(format!("wait: {e}"))
        }
        None => {
            emit("phase", "done:fail".into());
            Err(format!("install timed out after {INSTALL_TIMEOUT_SECS}s"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端把 meta.binary 原样作为 engine 串传 invoke(EngineCard cliInstallRun),
    /// 串必须能反序列化成枚举 —— 回归守护:曾因缺 qodercli/qoderclicn 变体安装直接报
    /// "unknown variant" 拒绝。
    #[test]
    fn engine_accepts_frontend_binary_names() {
        assert!(matches!(
            serde_json::from_str::<CliInstallEngine>("\"qodercli\"").unwrap(),
            CliInstallEngine::Qodercli
        ));
        assert!(matches!(
            serde_json::from_str::<CliInstallEngine>("\"qoderclicn\"").unwrap(),
            CliInstallEngine::Qoderclicn
        ));
        assert_eq!(
            npm_package(CliInstallEngine::Qodercli),
            "@qoder-ai/qodercli@latest"
        );
        assert_eq!(
            npm_package(CliInstallEngine::Qoderclicn),
            "@qodercn-ai/qoderclicn@latest"
        );
    }
}
