//! WSL 信息采集 —— 发行版枚举 + WSL 版本 + 默认发行版的 Linux 用户/home。
//!
//! 背景(2026-09-11 WSL 支持 P1):wsl.exe 自身的诊断输出(`-l -v`/`--version`)
//! 是 UTF-16LE,proc_communicate 的 from_utf8_lossy 会把它打成 NUL 噪音 ——
//! 本模块专用解码。`-e sh -c` 透传的 Linux 进程输出是 UTF-8,按字节收即可。
//! 非 Windows 平台不 spawn,直接 available=false。
//!
//! 消费方:src/plugins/wsl(WslCard 发行版列表/引擎探针前置)。spawn 进 WSL
//! 的 PTY 包装在前端 kernel/wsl.ts(命令面只有这一个读取口)。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistro {
    pub name: String,
    /// WSL 版本(1/2)。
    pub version: u8,
    /// "Running" | "Stopped"(原样保留 wsl.exe 词面,前端判 running 不区分大小写)。
    pub state: String,
    /// 带 `*` 默认标记的发行版。
    pub default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslInfo {
    /// false = 非 Windows 或 wsl.exe 不可用/无发行版。
    pub available: bool,
    pub wsl_version: Option<String>,
    pub distros: Vec<WslDistro>,
    /// 默认发行版 `echo $HOME`(发行版全停时为 None)。
    pub linux_home: Option<String>,
    /// 默认发行版 `id -un`。
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

#[cfg(windows)]
fn collect() -> Result<WslInfo, String> {
    use std::process::{Command, Stdio};

    let run = |args: &[&str]| -> Option<(Vec<u8>, Option<i32>)> {
        let mut cmd = Command::new("wsl.exe");
        crate::resolve::hide_console(&mut cmd);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let out = cmd.spawn().ok()?.wait_with_output().ok()?;
        Some((out.stdout, out.status.code()))
    };

    let Some((list_bytes, Some(0))) = run(&["-l", "-v"]) else {
        return Ok(WslInfo {
            available: false,
            wsl_version: None,
            distros: Vec::new(),
            linux_home: None,
            linux_user: None,
        });
    };
    let distros = parse_wsl_list(&decode_utf16le(&list_bytes));
    let wsl_version = run(&["--version"])
        .map(|(b, _)| decode_utf16le(&b))
        .and_then(|t| {
            t.lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && !l.starts_with("Copyright"))
                .map(str::to_owned)
        });

    // 默认发行版的 Linux 侧信息:透传输出是 UTF-8;发行版未运行时失败静默 None。
    let (linux_home, linux_user) = run(&["-e", "sh", "-c", "echo \"$HOME\"; id -un"])
        .map(|(b, code)| {
            if code != Some(0) {
                return (None, None);
            }
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
        available: !distros.is_empty(),
        wsl_version,
        distros,
        linux_home,
        linux_user,
    })
}

/// wsl.exe 诊断输出解码:剥 BOM,按 UTF-16LE 双字节对解码,截断 NUL。
#[cfg(windows)]
fn decode_utf16le(bytes: &[u8]) -> String {
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

/// 解析 `wsl.exe -l -v` 表:表头 `NAME STATE VERSION` 行后,数据行首列带
/// `*`(默认)或空格;列间多空格分隔。空表/无表头 → 空 Vec。
#[cfg(windows)]
fn parse_wsl_list(text: &str) -> Vec<WslDistro> {
    parse_wsl_list_impl(text)
}

/// 纯解析(无 windows cfg 依赖,单测跨平台可跑)。
#[cfg(not(windows))]
#[allow(dead_code)]
fn parse_wsl_list(text: &str) -> Vec<WslDistro> {
    parse_wsl_list_impl(text)
}

fn parse_wsl_list_impl(text: &str) -> Vec<WslDistro> {
    let mut out = Vec::new();
    let mut header_seen = false;
    for line in text.lines() {
        let t = line.trim_end();
        if !header_seen {
            if t.split_whitespace()
                .next()
                .is_some_and(|w| w.eq_ignore_ascii_case("NAME"))
                && t.split_whitespace()
                    .any(|w| w.eq_ignore_ascii_case("VERSION"))
            {
                header_seen = true;
            }
            continue;
        }
        let Some(col0) = t.split_whitespace().next() else {
            continue; // 空行
        };
        let default = col0 == "*";
        let cols: Vec<&str> = t.split_whitespace().collect();
        // 默认行: ["*", name, state, version];普通行: [name, state, version]
        let (name, state, version) = if default {
            if cols.len() < 4 {
                continue;
            }
            (cols[1], cols[2], cols[3])
        } else {
            if cols.len() < 3 {
                continue;
            }
            (cols[0], cols[1], cols[2])
        };
        let Ok(version) = version.trim_end_matches(".0").parse::<u8>() else {
            continue;
        };
        out.push(WslDistro {
            name: name.to_string(),
            version,
            state: state.to_string(),
            default,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_list_marks_default_and_state() {
        let text = "  NAME                   STATE           VERSION\n* Ubuntu-24.04         Running         2\n  docker-desktop         Stopped         2\n  Legacy                 Running         1\n";
        let d = parse_wsl_list(text);
        assert_eq!(d.len(), 3);
        assert_eq!(d[0].name, "Ubuntu-24.04");
        assert!(d[0].default);
        assert_eq!(d[0].state, "Running");
        assert_eq!(d[1].name, "docker-desktop");
        assert!(!d[1].default);
        assert_eq!(d[2].version, 1);
    }

    #[test]
    fn parse_list_rejects_garbage() {
        assert!(parse_wsl_list("").is_empty());
        assert!(parse_wsl_list("no header here").is_empty());
        // 表头后列数不足的行被跳过
        let d = parse_wsl_list("  NAME STATE VERSION\n* Ubuntu-24.04 Running\n");
        assert!(d.is_empty());
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
