//! 打开方式(open-with)—— 复刻 mossx:配置的外部应用/命令打开文件。
//! 契约:kernel/openWith.ts + kernel/ipc(fsOpenWith / fsProbeOpenApp / fsOpenAppIcon)。
//! 纪律同 fs_edit.rs:阻塞 IO 全走 spawn_fs;应用/命令知识由前端随 target 传入,
//! 本模块只持通用原语(系统启动器/PATH/进程),不做任何应用白名单。

use serde::{Deserialize, Serialize};
use std::path::Path;

/// 前端 OpenWithTarget 镜像(camelCase;缺省字段回落空值)。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithTarget {
    pub kind: String,
    #[serde(default)]
    pub app_name: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// 探测结果(ok=false 时 resolved_path 为 None;camelCase 对齐前端 OpenWithProbe)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithProbe {
    pub ok: bool,
    pub resolved_path: Option<String>,
}

/* ── 打开 ── */

/// 用目标打开 path;目标路径恒为最后参数。finder 复用 reveal;app 经系统启动器;command 直接 spawn。
fn open_with(path: &str, target: &OpenWithTarget) -> Result<(), String> {
    crate::fs_edit::validate_target(path)?;
    let p = Path::new(path);
    if !p.exists() {
        return Err("路径不存在".to_string());
    }
    match target.kind.as_str() {
        "finder" => crate::fs_edit::reveal_in_file_manager(path),
        "command" if !target.command.is_empty() => std::process::Command::new(&target.command)
            .args(&target.args)
            .arg(p)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("启动命令失败: {e}")),
        "app" if !target.app_name.is_empty() => open_with_app(p, target),
        _ => Err("打开方式配置不完整".to_string()),
    }
}

/// app 类 · macOS:`open -a <app> [--args …] <path>`;output+status 检查,应用缺失即时报错。
#[cfg(target_os = "macos")]
fn open_with_app(p: &Path, target: &OpenWithTarget) -> Result<(), String> {
    let mut cmd = std::process::Command::new("open");
    cmd.arg("-a").arg(&target.app_name);
    if !target.args.is_empty() {
        cmd.arg("--args").args(&target.args);
    }
    cmd.arg(p);
    let out = cmd.output().map_err(|e| format!("打开应用失败: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "打开应用失败: exit code {}",
            out.status.code().unwrap_or(-1)
        ))
    }
}

/// app 类 · 非 macOS:应用名按 PATH 命令/可执行路径尽力(spawn 不等,编辑器常驻不阻塞)。
#[cfg(not(target_os = "macos"))]
fn open_with_app(p: &Path, target: &OpenWithTarget) -> Result<(), String> {
    std::process::Command::new(&target.app_name)
        .args(&target.args)
        .arg(p)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开应用失败: {e}"))
}

/* ── 探测(设置面板「可用」徽标 + 添加对话框灰显;不持久化)── */

fn probe_open_app(target: &OpenWithTarget) -> OpenWithProbe {
    match target.kind.as_str() {
        "finder" => OpenWithProbe {
            ok: true,
            resolved_path: None,
        },
        "app" if !target.app_name.is_empty() => probe_app_bundle(&target.app_name),
        "command" if !target.command.is_empty() => probe_command(&target.command),
        _ => OpenWithProbe {
            ok: false,
            resolved_path: None,
        },
    }
}

/// app 探测 · macOS:app_name 为 .app 路径直接存在性;否则在标准应用目录找 `<名>.app`。
#[cfg(target_os = "macos")]
fn probe_app_bundle(app_name: &str) -> OpenWithProbe {
    if app_name.ends_with(".app") {
        let ok = Path::new(app_name).is_dir();
        return OpenWithProbe {
            ok,
            resolved_path: ok.then(|| app_name.to_string()),
        };
    }
    for dir in macos_app_search_dirs() {
        let candidate = dir.join(format!("{app_name}.app"));
        if candidate.is_dir() {
            return OpenWithProbe {
                ok: true,
                resolved_path: candidate.to_str().map(|s| s.to_string()),
            };
        }
    }
    OpenWithProbe {
        ok: false,
        resolved_path: None,
    }
}

/// app 探测 · 非 macOS:可执行路径存在性,否则回落 PATH 解析。
#[cfg(not(target_os = "macos"))]
fn probe_app_bundle(app_name: &str) -> OpenWithProbe {
    if Path::new(app_name).exists() {
        return OpenWithProbe {
            ok: true,
            resolved_path: Some(app_name.to_string()),
        };
    }
    probe_command(app_name)
}

/// command 探测:which / where 解析 PATH。
fn probe_command(command: &str) -> OpenWithProbe {
    let finder = if cfg!(windows) { "where" } else { "which" };
    let ok = match std::process::Command::new(finder).arg(command).output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .is_some_and(|l| !l.trim().is_empty()),
        _ => false,
    };
    OpenWithProbe {
        ok,
        resolved_path: None,
    }
}

/// macOS 标准应用目录(mossx 同款 + /System/Applications/Utilities)。
#[cfg(target_os = "macos")]
fn macos_app_search_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = [
        "/Applications",
        "/System/Applications",
        "/Applications/Utilities",
        "/System/Applications/Utilities",
    ]
    .iter()
    .map(std::path::PathBuf::from)
    .collect();
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(std::path::PathBuf::from(home).join("Applications"));
    }
    dirs
}

/* ── 图标(OS 提取 → png base64 data URL;失败 None,前端回落通用图标)── */

/// 图标 · macOS:定位 bundle → Resources 首个 .icns → sips 转 png → base64。
#[cfg(target_os = "macos")]
fn open_app_icon(app_name: &str) -> Option<String> {
    let bundle = locate_macos_app_bundle(app_name)?;
    let resources = bundle.join("Contents").join("Resources");
    let icns = std::fs::read_dir(&resources)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            p.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("icns"))
        })?;
    let out_png =
        std::env::temp_dir().join(format!("tmd-openwith-icon-{}.png", std::process::id()));
    let converted = std::process::Command::new("sips")
        .args(["-s", "format", "png"])
        .arg(&icns)
        .arg("--out")
        .arg(&out_png)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|_| std::fs::read(&out_png).ok());
    let _ = std::fs::remove_file(&out_png);
    let bytes = converted?;
    use base64::Engine as _;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// bundle 定位:.app 路径直接用;应用名在标准目录找 `<名>.app`。
#[cfg(target_os = "macos")]
fn locate_macos_app_bundle(app_name: &str) -> Option<std::path::PathBuf> {
    if app_name.ends_with(".app") {
        let p = std::path::PathBuf::from(app_name);
        return p.is_dir().then_some(p);
    }
    macos_app_search_dirs()
        .into_iter()
        .map(|d| d.join(format!("{app_name}.app")))
        .find(|c| c.is_dir())
}

/// 图标 · Windows:PowerShell ExtractAssociatedIcon → PNG base64(CREATE_NO_WINDOW 防闪窗)。
#[cfg(target_os = "windows")]
fn open_app_icon(app_name: &str) -> Option<String> {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let script = format!(
        "Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon('{app_name}'); \
         $ms=New-Object System.IO.MemoryStream; $i.ToBitmap().Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); \
         [Convert]::ToBase64String($ms.ToArray())"
    );
    let out = {
        use std::os::windows::process::CommandExt as _;
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?
    };
    if !out.status.success() {
        return None;
    }
    let b64 = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!b64.is_empty()).then(|| format!("data:image/png;base64,{b64}"))
}

/// 图标 · Linux:无通用提取通道,回落前端通用图标。
#[cfg(all(unix, not(target_os = "macos")))]
fn open_app_icon(_app_name: &str) -> Option<String> {
    None
}

/* ── Tauri command 包装(签名风格与 fs_edit.rs 一致;阻塞 IO 走 spawn_fs)── */

#[tauri::command]
pub(crate) async fn fs_open_with(path: String, target: OpenWithTarget) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || open_with(&path, &target)).await
}

#[tauri::command]
pub(crate) async fn fs_probe_open_app(target: OpenWithTarget) -> Result<OpenWithProbe, String> {
    crate::commands_fs::spawn_fs(move || Ok(probe_open_app(&target))).await
}

#[tauri::command]
pub(crate) async fn fs_open_app_icon(app_name: String) -> Result<Option<String>, String> {
    crate::commands_fs::spawn_fs(move || Ok(open_app_icon(&app_name))).await
}
