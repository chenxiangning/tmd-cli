//! WSL 信息采集 —— 发行版枚举 + WSL 版本 + 默认发行版的 Linux 用户/home。
//!
//! 背景(2026-09-11 WSL 支持 P1;同日 review 收口):
//! - wsl.exe 自身诊断输出(`-l -v`/`--version`)是 UTF-16LE,proc_communicate 的
//!   from_utf8_lossy 会打成 NUL 噪音 —— 本模块专用解码。`-e sh -c` 透传的 Linux
//!   进程输出是 UTF-8,按字节收即可。非 Windows 平台不 spawn,直接 available=false。
//! - 表解析不依赖表头/状态列语言(中文 Windows 输出「名称/状态/版本」「正在运行」):
//!   数据行按「末列 ∈ {1,2}」锚定;运行态用 `-l -v --running` 名单求交,跨 locale 可靠。
//! - 所有子进程带超时(默认发行版停止时 `-e` 会触发 VM 冷启动,可达十几秒;
//!   WSL 挂死时 wsl.exe 可无限阻塞,绝不裸 wait)。
//!
//! 消费方:src/plugins/wsl(WslCard 发行版列表)。spawn 进 WSL 的 PTY 包装在
//! 前端 kernel/wsl.ts(命令面只有这一个读取口)。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistro {
    pub name: String,
    /// 1 | 2(末列版本号)。
    pub version: u8,
    /// 由 `-l -v --running` 名单求交得出(不读状态列,locale 无关)。
    pub running: bool,
    /// wslconfig 默认发行版(表首列 `*`)。
    pub default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslInfo {
    /// false = 非 Windows / wsl.exe 不可用 / 超时 / 无发行版。
    pub available: bool,
    pub wsl_version: Option<String>,
    pub distros: Vec<WslDistro>,
    /// 默认发行版 $HOME(发行版冷启动超时/失败时 None)。
    pub linux_home: Option<String>,
    pub linux_user: Option<String>,
}

#[tauri::command]
pub(crate) async fn wsl_info() -> Result<WslInfo, String> {
    tauri::async_runtime::spawn_blocking(collect)
        .await
        .map_err(|e| format!("wsl_info join 失败: {e}"))?
}

#[cfg(not(windows))]
fn collect() -> Result<WslInfo, String> {
    Ok(WslInfo {
        available: false,
        wsl_version: None,
        distros: Vec::new(),
        linux_home: None,
        linux_user: None,
    })
}

/// 带超时地跑 wsl.exe 诊断命令,收 stdout 原始字节(UTF-16LE 由调用方解码)。
/// 超时/失败返回 None(杀树收尸,不留孤儿)。
#[cfg(windows)]
pub(crate) fn run_bounded(args: &[&str], timeout_ms: u64) -> Option<(Vec<u8>, Option<i32>)> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    let mut cmd = Command::new("wsl.exe");
    crate::resolve::hide_console(&mut cmd);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let mut out = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    match rx.recv_timeout(Duration::from_millis(timeout_ms)) {
        Ok(buf) => {
            let code = child.wait().ok().and_then(|s| s.code());
            Some((buf, code))
        }
        Err(_) => {
            crate::resolve::kill_tree(&mut child);
            let _ = child.wait();
            None
        }
    }
}

#[cfg(windows)]
fn collect() -> Result<WslInfo, String> {
    // 全量表:15s 上限(纯枚举,正常 <1s;挂死时宁可报不可用)。
    let Some((list_bytes, Some(0))) = run_bounded(&["-l", "-v"], 15_000) else {
        return Ok(unavailable());
    };
    let mut distros = parse_wsl_list(&decode_utf16le(&list_bytes));
    if distros.is_empty() {
        return Ok(unavailable());
    }
    // 运行态名单:同一张表加 --running;失败(老版 wsl.exe 不认参数)静默按全停处理。
    if let Some((run_bytes, Some(0))) = run_bounded(&["-l", "-v", "--running"], 15_000) {
        mark_running(&mut distros, &decode_utf16le(&run_bytes));
    }
    let wsl_version = run_bounded(&["--version"], 10_000)
        .map(|(b, _)| decode_utf16le(&b))
        .and_then(|t| {
            t.lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && !l.starts_with("Copyright"))
                .map(str::to_owned)
        });

    // 默认发行版的 Linux 侧信息:发行版全停时这条会触发 VM 冷启动 —— 给 25s 宽限,
    // 超时静默 None(卡照常可用,只是缺 $HOME/用户 facts 行)。透传输出是 UTF-8。
    let (linux_home, linux_user) =
        run_bounded(&["-e", "sh", "-c", "echo \"$HOME\"; id -un"], 25_000)
            .filter(|(_, code)| *code == Some(0))
            .map(|(b, _)| {
                let text = String::from_utf8_lossy(&b);
                let mut lines = text.lines().map(str::trim);
                (
                    lines
                        .next()
                        .filter(|s| s.starts_with('/'))
                        .map(str::to_owned),
                    lines.next().filter(|s| !s.is_empty()).map(str::to_owned),
                )
            })
            .unwrap_or((None, None));

    Ok(WslInfo {
        available: true,
        wsl_version,
        distros,
        linux_home,
        linux_user,
    })
}

/// 全不可用形态(本机收集失败与远程探测失败共用)。
pub(crate) fn unavailable() -> WslInfo {
    WslInfo {
        available: false,
        wsl_version: None,
        distros: Vec::new(),
        linux_home: None,
        linux_user: None,
    }
}

/// wsl.exe 诊断输出解码:剥 BOM,按 UTF-16LE 双字节对解码,截断 NUL。
/// (远程路径同样吃到 UTF-16LE —— 经 ssh exec 非 PTY stdout 亦是,wsl_remote.rs 共用。)。
pub(crate) fn decode_utf16le(bytes: &[u8]) -> String {
    let body = bytes.strip_prefix(&[0xFFu8, 0xFEu8]).unwrap_or(bytes);
    let units: Vec<u16> = body
        .chunks(2)
        .filter_map(|c| <[u8; 2]>::try_from(c).ok())
        .map(u16::from_le_bytes)
        .collect();
    String::from_utf16_lossy(&units)
        .trim_end_matches('\0')
        .to_string()
}

#[cfg(windows)]
fn parse_wsl_list(text: &str) -> Vec<WslDistro> {
    parse_wsl_list_impl(text)
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn parse_wsl_list(text: &str) -> Vec<WslDistro> {
    parse_wsl_list_impl(text)
}

/// 解析 `wsl.exe -l -v` 表(locale 无关):数据行 = 3 列(或 `*` 打头的 4 列)且
/// 末列 ∈ {1,2}(容忍 "2.0" 形态)。表头行(任何语言的「名称/NAME」)末列不是
/// 版本号,天然被锚定规则排除。已知限制:发行版名含空格时列切分会错位(wsl 允许
/// 但极罕见;STATE 列各 locale 均无空格)。
pub(crate) fn parse_wsl_list_impl(text: &str) -> Vec<WslDistro> {
    let mut out = Vec::new();
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        let (default, name, ver) = match cols.len() {
            3 => (false, cols[0], cols[2]),
            4 if cols[0] == "*" => (true, cols[1], cols[3]),
            _ => continue,
        };
        let Ok(version) = ver.trim_end_matches(".0").parse::<u8>() else {
            continue;
        };
        if version != 1 && version != 2 {
            continue;
        }
        out.push(WslDistro {
            name: name.to_string(),
            version,
            running: false,
            default,
        });
    }
    out
}

#[cfg(windows)]
fn mark_running(distros: &mut [WslDistro], running_text: &str) {
    mark_running_impl(distros, running_text)
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn mark_running(distros: &mut [WslDistro], running_text: &str) {
    mark_running_impl(distros, running_text)
}

/// 用 `--running` 表(同格式,只含运行中发行版)的名字集合给全量表打 running 标。
/// 名字按 ASCII 大小写不敏感比对(wsl 发行版名不区分大小写)。
pub(crate) fn mark_running_impl(distros: &mut [WslDistro], running_text: &str) {
    let names = parse_wsl_list_impl(running_text);
    for d in distros.iter_mut() {
        d.running = names.iter().any(|r| r.name.eq_ignore_ascii_case(&d.name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_list_marks_default_and_version() {
        let text = "  NAME                   STATE           VERSION\n* Ubuntu-24.04         Running         2\n  docker-desktop         Stopped         2\n  Legacy                 Running         1\n";
        let d = parse_wsl_list(text);
        assert_eq!(d.len(), 3);
        assert_eq!(d[0].name, "Ubuntu-24.04");
        assert!(d[0].default);
        assert_eq!(d[1].name, "docker-desktop");
        assert!(!d[1].default);
        assert_eq!(d[2].version, 1);
        assert!(!d[0].running); // 运行态只来自 --running 求交
    }

    #[test]
    fn parse_list_survives_localized_headers_and_states() {
        // 中文 Windows:表头「名称 状态 版本」、状态「正在运行/已停止」。
        let text = "  名称                   状态            版本\n* Ubuntu-24.04         正在运行        2\n  Debian-12            已停止          2\n";
        let d = parse_wsl_list(text);
        assert_eq!(d.len(), 2);
        assert!(d[0].default);
        assert_eq!(d[1].name, "Debian-12");
    }

    #[test]
    fn parse_list_rejects_garbage() {
        assert!(parse_wsl_list("").is_empty());
        assert!(parse_wsl_list("no header here").is_empty());
        // 末列不是 1/2 的行(表头、说明行、列数不足)全部跳过
        let d = parse_wsl_list("  NAME STATE VERSION\n* Ubuntu-24.04 Running\n");
        assert!(d.is_empty());
    }

    #[test]
    fn mark_running_intersects_by_name() {
        let full = "  NAME STATE VERSION\n* Ubuntu-24.04 已停止 2\n  Debian-12 已停止 2\n";
        let mut d = parse_wsl_list(full);
        let running = "  NAME STATE VERSION\n* Ubuntu-24.04 正在运行 2\n";
        mark_running(&mut d, running);
        assert!(d[0].running);
        assert!(!d[1].running);
    }

    #[cfg(windows)]
    #[test]
    fn decode_utf16le_strips_bom_and_nul() {
        let mut bytes = vec![0xFF, 0xFE];
        for u in "AB中".encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        bytes.push(0);
        bytes.push(0);
        assert_eq!(decode_utf16le(&bytes), "AB中");
    }
}
