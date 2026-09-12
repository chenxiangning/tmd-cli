//! 远程 WSL 操作命令 —— 目录懒加载(wsl_list_dir)、引擎探针(wsl_probe_engines)
//! 与远程文件文本读取(wsl_read_file_text)。
//! 自 wsl_remote.rs 拆出(文件规模铁则);通道层(exec_somewhere/exec_collect/
//! connect_trusting)在 wsl_remote.rs,这里只做命令装配、参数校验与输出解析。

use super::wsl_remote::exec_somewhere;

/// 标准 base64 编码(单行;字符集 [A-Za-z0-9+/=] 不含 PowerShell 特殊字符,
/// 可安全内嵌进 `bash -c "echo <b64>|base64 -d|bash"` 形态)。
pub(crate) fn b64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 把脚本经 b64 载荷送进发行版 bash 执行(实测:命令行直排脚本会被宿主
/// PowerShell 拆坏引号/`$()`;b64 字符集对 PS 双引号串完全惰性,全链保真)。
pub(crate) fn wsl_bash_payload(distro: &str, script: &str) -> String {
    let distro_quoted = format!("\"{}\"", distro.trim().replace('"', ""));
    format!(
        "wsl.exe -d {distro_quoted} -- bash -c \"echo {}|base64 -d|bash\"",
        b64_encode(script.as_bytes())
    )
}

/// 标准 base64 解码(容忍 `base64` 命令默认的 76 列换行;要求成对 padding)。
pub(crate) fn b64_decode(data: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Result<u32, String> {
        match c {
            b'A'..=b'Z' => Ok(u32::from(c - b'A')),
            b'a'..=b'z' => Ok(u32::from(c - b'a') + 26),
            b'0'..=b'9' => Ok(u32::from(c - b'0') + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err(format!("非法 base64 字符: {:?}", c as char)),
        }
    }
    let clean: Vec<u8> = data
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        if chunk.len() == 1 {
            return Err("base64 长度非法".to_string());
        }
        let mut n: u32 = 0;
        for (i, c) in chunk.iter().enumerate() {
            n |= val(*c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Ok(out)
}
use crate::ssh::transport::SshHostWire;

/// 目录条目(`wsl_list_dir` 返回行)。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDirEntry {
    pub name: String,
    pub is_dir: bool,
}

/// 引擎探针结果(`wsl_probe_engines` 返回行;path=None = 未检出)。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslEngineProbe {
    pub bin: String,
    pub path: Option<String>,
}

/// 参数路径白名单校验:仅允许 `[A-Za-z0-9_./~-]`(`~` 起始可用;bash 双引号内 `~`
/// 不展开,故内层命令不引 path,靠白名单保证无注入面)。空格路径不支持(报错提示)。
fn validate_path_component(path: &str) -> Result<(), String> {
    if path.is_empty()
        || !path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '.' | '-' | '~'))
    {
        return Err("路径含不支持的字符(暂不支持空格与引号)".to_string());
    }
    Ok(())
}

fn validate_bin(bin: &str) -> Result<(), String> {
    if bin.is_empty()
        || !bin
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(format!("非法 binary 名: {bin}"));
    }
    Ok(())
}

/// 目录懒加载(添加工作区弹层/远程会话起始目录选择)。
/// host=None = 本机 wsl.exe(仅 Windows);host=Some = 经 SSH 连远程宿主执行。
#[tauri::command]
pub(crate) async fn wsl_list_dir(
    distro: String,
    path: String,
    host: Option<SshHostWire>,
) -> Result<Vec<WslDirEntry>, String> {
    validate_path_component(&path)?;
    // ls -1ap:目录带尾 `/`;`--` 挡 `-` 开头路径;输出过滤 . / .. 与空行。
    // 脚本走 b64 载荷(命令行直排会被宿主 PowerShell 拆坏引号,见 wsl_bash_payload)。
    let command = wsl_bash_payload(&distro, &format!("ls -1ap -- {path}"));
    let (text, code) = exec_somewhere(&command, host).await?;
    if code != Some(0) {
        return Err(format!("ls 失败(code={code:?})"));
    }
    Ok(text
        .lines()
        .filter_map(|line| {
            let line = line.trim_end_matches('\r');
            if line.is_empty() || line == "./" || line == "../" || line == "." || line == ".." {
                return None;
            }
            let is_dir = line.ends_with('/');
            Some(WslDirEntry {
                name: line.trim_end_matches('/').to_string(),
                is_dir,
            })
        })
        .collect())
}

/// 引擎探针:逐 binary `command -v`(bins 由前端从 cli profile 清单传入,内核零引擎知识)。
#[tauri::command]
pub(crate) async fn wsl_probe_engines(
    distro: String,
    bins: Vec<String>,
    host: Option<SshHostWire>,
) -> Result<Vec<WslEngineProbe>, String> {
    for b in &bins {
        validate_bin(b)?;
    }
    let list = bins.join(" ");
    // `bin:path` 行协议(Linux 路径约定无冒号)。脚本走 b64 载荷(同上)。
    // PATH 用登录 shell 语义(与引擎 spawn 的 `bash -lc` 对齐):source ~/.profile
    // 后再补 ~/.local/bin —— Ubuntu 标准用户 bin 目录只进登录 PATH,omp 装在
    // ~/.local/bin 时非登录 `bash -c` 探不到,误报未检出(2026-09-12 大仙实测)。
    let script = format!(
        "[ -r \"$HOME/.profile\" ] && . \"$HOME/.profile\" >/dev/null 2>&1 || true; \
         PATH=\"$HOME/.local/bin:$PATH\"; export PATH; \
         for b in {list}; do p=$(command -v $b 2>/dev/null); echo $b:$p; done"
    );
    let command = wsl_bash_payload(&distro, &script);
    let (text, _) = exec_somewhere(&command, host).await?;
    Ok(parse_probe_lines(&text))
}

/// 解析 `bin:path` 行协议 → 探针结果。/mnt/* 视为未检出:WSL 互操作会把
/// Windows PATH 带进发行版,`command -v` 由此检出 Windows 侧安装(如
/// /mnt/c/.../npm/omp)—— 那是 Windows 进程不是发行版内安装,探针若照报,
/// 用户会拿它开「WSL 里的引擎」会话,实际跑的是 Windows 二进制(2026-09-11
/// 大仙实测 192.168.1.7 十个引擎九个 /mnt/c 误报)。发行版内真装与否以此为准。
fn parse_probe_lines(text: &str) -> Vec<WslEngineProbe> {
    text.lines()
        .filter_map(|line| {
            let mut it = line.splitn(2, ':');
            let bin = it.next()?.trim().to_string();
            let path = it.next().map(str::trim).unwrap_or("");
            Some(WslEngineProbe {
                bin,
                path: if path.is_empty() || path.starts_with("/mnt/") {
                    None
                } else {
                    Some(path.to_string())
                },
            })
        })
        .collect()
}

/// 远程文件文本(`wsl_read_file_text` 返回;content=None = 超限不读,前端出 M1 提示)。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslRemoteFileText {
    pub size: u64,
    pub content: Option<String>,
    pub truncated: bool,
}

/// 解析 `size=<n>` 行 + base64 段(容忍 wsl 代理警告等杂散前缀行:取首个 size= 行)。
fn parse_remote_file_text(text: &str) -> Result<WslRemoteFileText, String> {
    let mut lines = text
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .peekable();
    let size = loop {
        let line = lines.next().ok_or("远程文件读取输出异常(无 size 行)")?;
        if let Some(n) = line.strip_prefix("size=") {
            break n
                .parse::<u64>()
                .map_err(|_| format!("远程文件 size 非法: {n}"))?;
        }
    };
    let b64: String = lines.map(str::trim).collect();
    if b64.is_empty() {
        return Ok(WslRemoteFileText {
            size,
            content: None,
            truncated: true,
        });
    }
    let bytes = b64_decode(&b64)?;
    Ok(WslRemoteFileText {
        size,
        content: Some(String::from_utf8_lossy(&bytes).to_string()),
        truncated: false,
    })
}

/// 远程脚本执行通道(来源 remoteExec 协议的传输层):引擎适配器产出脚本
/// (各自的会话目录/解析知识),本命令只负责 b64 载荷送进发行版 bash。
/// 非零退出不报错:grep 无匹配/文件缺失等对调用方是「空数据」而非失败。
#[tauri::command]
pub(crate) async fn wsl_exec(
    distro: String,
    script: String,
    host: Option<SshHostWire>,
) -> Result<String, String> {
    let command = wsl_bash_payload(&distro, &script);
    let (text, _) = exec_somewhere(&command, host).await?;
    Ok(text)
}

/// 远程文件文本读取(远程 WSL 工作区文件树 → 本地渲染管线;M1 只读,不做写回)。
/// host=None = 本机 wsl.exe(仅 Windows);host=Some = 经 SSH 连远程宿主执行。
#[tauri::command]
pub(crate) async fn wsl_read_file_text(
    distro: String,
    path: String,
    max_bytes: u64,
    host: Option<SshHostWire>,
) -> Result<WslRemoteFileText, String> {
    validate_path_component(&path)?;
    let max_bytes = max_bytes.clamp(1, 4 * 1024 * 1024);
    // 行协议:size=<n> 行 + base64 段。目录/不可读 → wc 失败 exit 9(如实报错,
    // 与 ls 同一白名单路径纪律);超限不读内容(前端出提示,不喂半个文件进渲染)。
    let script = format!(
        "s=$(wc -c < {path}) || exit 9; echo size=$s; [ \"$s\" -le {max_bytes} ] && head -c {max_bytes} {path} | base64; true"
    );
    let command = wsl_bash_payload(&distro, &script);
    let (text, code) = exec_somewhere(&command, host).await?;
    if code == Some(9) {
        return Err("不是常规文件或不可读".to_string());
    }
    parse_remote_file_text(&text)
}

#[cfg(test)]
#[path = "wsl_remote_ops_tests.rs"]
mod tests;
