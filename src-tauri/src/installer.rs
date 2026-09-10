//! CLI 安装器 —— 参数化安装计划的执行器,stdout/stderr 逐行流式推前端。
//!
//! 内核不持有任何 CLI 安装配方:通道与参数(npm 包名 / 官方脚本命令 / 通用
//! 命令)由前端按 CliProfile 或面板语义传入,本模块只执行三种通用通道:
//! - npm:全局安装最新版(`npm install -g <package>`,Windows 经 cmd /c
//!   跑 npm.cmd shim);
//! - script:官方安装脚本(unix `bash -c '…'`;Windows PowerShell -Command);
//! - command:通用命令直执行(program + args 原样;Windows 经 cmd /c 兼容
//!   .cmd shim,omp plugin 装卸等前端传参)。
//!
//! 事件协议(Tauri event,topic = `cli-install://{id}`,id 由前端传,惯例 = 引擎 binary):
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

use crate::resolve::{enriched_path, hide_console};

/// 安装超时(秒)。npm 全局安装在慢网络下分钟级;对齐 codemoss INSTALL_TIMEOUT_SECS。
const INSTALL_TIMEOUT_SECS: u64 = 300;

/// 安装计划 —— 前端按 CliProfile 声明构造(camelCase tagged union)。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "channel")]
pub enum InstallPlan {
    /// npm 全局安装(@latest 钉最新版)。
    Npm {
        /// 包名(不带 @latest 后缀)。
        package: String,
    },
    /// 官方脚本安装(unix/windows 各一条完整命令串)。
    Script { unix: String, windows: String },
    /// 通用命令通道:program + args 由前端传入(omp plugin 装卸等),内核零配方。
    Command { program: String, args: Vec<String> },
}

/// 推给前端的单行事件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallEvent {
    pub stream: String,
    pub text: String,
}

/// 构造安装命令(program + args)。
/// npm:Windows 经 cmd /c 跑 npm.cmd shim;script:unix 走 bash -c,windows 走 powershell;
/// command:unix 直 spawn,windows 经 cmd /c 兼容 .cmd shim。
fn install_command(plan: &InstallPlan, npm_prefix: Option<&str>) -> (String, Vec<String>) {
    match plan {
        InstallPlan::Npm { package } => {
            let pkg = format!("{package}@latest");
            /* npm 12(2026-07)起 install scripts 默认禁用(allowScripts 机制),
             * 被挡的 postinstall 只发 warn 不报错 —— opencode-ai 这类靠
             * postinstall 拷平台二进制的包会留下 stub 启动器,运行即报
             * "postinstall script was not run"(2026-09-05 本机实证)。
             * 解法 = npm 自己在 warn 里给的逐包放行旗标 --allow-scripts=<pkg>
             * (npm 12 实证有效;旧 --ignore-scripts=false 是遗留开关,压不过
             * 新机制,实证无效)。npm ≤11 对未知旗标仅 warn 不失败(11.6.2
             * 实证),可无条件追加。 */
            let allow = format!("--allow-scripts={package}");
            /* 双副本遮蔽修复:探针命中的副本可能不在 npm 默认 prefix(用户 PATH
             * 中 hermes/nvm/官方安装器等排在 npm prefix 之前,npm install -g
             * 写 prefix 副本,探针仍见旧副本 —— 2026-09-11 本机实证 kimi/
             * opencode)。命中副本若是 node 全局布局(<X>/bin/<bin> 且
             * <X>/lib/node_modules 存在),加 --prefix <X> 就地更新。 */
            let prefix_args: Vec<String> = match npm_prefix {
                Some(p) => vec!["--prefix".into(), p.to_string()],
                None => vec![],
            };
            /* Windows 路径分隔符归一:cfg 分支里各消费 prefix_args,不可二次赋值。 */
            #[cfg(windows)]
            let prefix_args: Vec<String> = prefix_args
                .into_iter()
                .map(|a| a.replace('/', "\\"))
                .collect();
            #[cfg(windows)]
            {
                return (
                    "cmd".into(),
                    [
                        vec!["/c".into(), "npm".into(), "install".into(), "-g".into()],
                        prefix_args,
                        vec![pkg, allow],
                    ]
                    .concat(),
                );
            }
            #[cfg(not(windows))]
            (
                "npm".into(),
                [
                    vec!["install".into(), "-g".into()],
                    prefix_args,
                    vec![pkg, allow],
                ]
                .concat(),
            )
        }
        InstallPlan::Script { unix, windows } => {
            /* 两侧字段都借引用消费一次:未激活平台侧不产生 unused 告警。 */
            let _ = (&unix, &windows);
            #[cfg(windows)]
            return (
                "powershell".into(),
                vec!["-NoProfile".into(), "-Command".into(), windows.clone()],
            );
            #[cfg(not(windows))]
            ("bash".into(), vec!["-c".into(), unix.clone()])
        }
        InstallPlan::Command { program, args } => {
            /* 通用命令:unix 直 spawn;Windows 经 cmd /c 兼容 .cmd shim
             * (npm 全局 bin 与 omp 在 Windows 上都可能是 .cmd,直 spawn 找不到)。 */
            #[cfg(windows)]
            return {
                let mut wrapped = Vec::with_capacity(args.len() + 2);
                wrapped.push("/c".to_string());
                wrapped.push(program.clone());
                wrapped.extend(args.iter().cloned());
                ("cmd".into(), wrapped)
            };
            #[cfg(not(windows))]
            (program.clone(), args.clone())
        }
    }
}

/// npm 通道就地更新目标推导:探针 binary 命中的绝对路径若位于
/// `<X>/bin/<binary>`(unix)且 `<X>/lib/node_modules` 存在(node 全局布局),
/// 返回 Some(X);否则 None(保持 npm 默认 prefix)。探针失败/未装 = None。
fn probe_npm_prefix(binary: &str) -> Option<String> {
    let result = crate::probe::probe_cli(binary);
    let path = result.path?;
    /* unix 布局:<X>/bin/<binary>;Windows npm 全局是 <X>/<binary>.cmd(无 bin 段),
     * 布局不同,暂不对齐(Windows 单副本场景居多)。 */
    let dir = std::path::Path::new(&path).parent()?;
    if dir.file_name()?.to_str()? != "bin" {
        return None;
    }
    let prefix = dir.parent()?.to_str()?.to_string();
    if std::path::Path::new(&prefix)
        .join("lib/node_modules")
        .is_dir()
    {
        Some(prefix)
    } else {
        None
    }
}

/// 执行安装:spawn → 双线程逐行泵 stdout/stderr → 事件流 → 等退出。
/// 返回 Ok(成功?) — exit code 0 = true。命令构建失败/超时返回 Err。
pub fn run_install(app: &AppHandle, id: &str, plan: &InstallPlan) -> Result<bool, String> {
    let topic = format!("cli-install://{id}");
    let emit = |stream: &str, text: String| {
        let _ = app.emit(
            &topic,
            CliInstallEvent {
                stream: stream.to_string(),
                text,
            },
        );
    };

    /* npm 通道:探针命中副本的就地 --prefix 对齐(推导失败 = None,走 npm 默认 prefix)。 */
    let npm_prefix = match plan {
        InstallPlan::Npm { .. } => probe_npm_prefix(id),
        _ => None,
    };
    let (program, args) = install_command(plan, npm_prefix.as_deref());
    emit("phase", "start".into());
    emit("stdout", format!("$ {} {}", program, args.join(" ")));

    let mut cmd = Command::new(&program);
    cmd.args(&args);
    cmd.env("PATH", enriched_path());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    /* Windows 下 cmd /c npm 与 powershell 都是控制台子系统,GUI 拉起会弹窗 */
    hide_console(&mut cmd);
    /* 防挂:子进程若继承 stdin 且安装脚本读输入,会永久等待。 */
    cmd.stdin(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("spawn {program}: {e}"))?;

    /* 双线程逐行泵:stdout/stderr 各一个,AppHandle clone 进线程(Send)。
    泛型 over Read:ChildStdout/ChildStderr 是不同类型,闭包无法复用。
    泵完成经 channel 回执,不 join:npm 拉起的孙进程(node 脚本可守护化)
    可能握管道写端,join 会让安装命令在超时后仍不返回。 */
    fn pump<R: std::io::Read + Send + 'static>(
        reader: Option<R>,
        stream: &'static str,
        app: &AppHandle,
        topic: &str,
    ) -> Option<std::sync::mpsc::Receiver<()>> {
        reader.map(|r| {
            let app2 = app.clone();
            let topic2 = topic.to_string();
            let (tx, rx) = std::sync::mpsc::channel::<()>();
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
                let _ = tx.send(());
            });
            rx
        })
    }
    let out_rx = pump(child.stdout.take(), "stdout", app, &topic);
    let err_rx = pump(child.stderr.take(), "stderr", app, &topic);

    let exit = crate::resolve::wait_child_with_timeout(
        &mut child,
        std::time::Duration::from_secs(INSTALL_TIMEOUT_SECS),
    );
    /* 泵线程在放弃等待后仍会继续排空管道(防孙进程写阻塞),迟到的行
     * 照常 emit,无害;这里只做有限等待。 */
    let drain_wait = std::time::Duration::from_secs(5);
    if let Some(rx) = out_rx {
        let _ = rx.recv_timeout(drain_wait);
    }
    if let Some(rx) = err_rx {
        let _ = rx.recv_timeout(drain_wait);
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
#[path = "installer_tests.rs"]
mod tests;
