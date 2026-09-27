//! Web 命令桥 —— 镜像 invoke_handler 全量命令(平台专属 app_restart 除外)。
//! 新增宿主命令必须同步在此登记(与 lib.rs invoke_handler 同纪律)。

// file-size-exempt: 327 行(2026-09-25 merge 线契约测试并入);拆出即伤对照性(dispatch 是命令面镜像总表,lib.rs 是装配总表)。
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::{dispatch_fs, dispatch_git, dispatch_session, dispatch_ssh};

pub(super) async fn dispatch(app: &AppHandle, cmd: &str, raw: Value) -> Result<Value, String> {
    if let Some(r) = dispatch_fs::try_dispatch(app, cmd, &raw).await {
        return r;
    }
    if let Some(r) = dispatch_git::try_dispatch(app, cmd, &raw).await {
        return r;
    }
    if let Some(r) = dispatch_session::try_dispatch(app, cmd, &raw).await {
        return r;
    }
    if let Some(r) = dispatch_ssh::try_dispatch(app, cmd, &raw).await {
        return r;
    }
    misc_dispatch(app, cmd, raw).await
}

pub(super) fn args<T: DeserializeOwned>(raw: &Value) -> Result<T, String> {
    serde_json::from_value(raw.clone()).map_err(|e| format!("参数错误: {e}"))
}

pub(super) fn val<T: Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| format!("序列化失败: {e}"))
}

pub(super) fn ser<T: Serialize>(r: Result<T, String>) -> Result<Value, String> {
    r.and_then(val)
}

/// 阻塞/磁盘命令的统一出口:不占 async executor(与 spawn_fs 同纪律)。
pub(super) async fn block<T: Serialize + Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<Value, String> {
    match tokio::task::spawn_blocking(f).await {
        Ok(r) => ser(r),
        Err(e) => Err(format!("join 失败: {e}")),
    }
}

/// misc/config/quota/cli/plugins/wsl/sqlite 域。
async fn misc_dispatch(app: &AppHandle, cmd: &str, raw: Value) -> Result<Value, String> {
    match cmd {
        "md5_hex" => val(crate::hash::md5_hex(args::<OneText>(&raw)?.text)),
        "platform_kind" => val(std::env::consts::OS),
        "config_home_dir" => val(crate::session::home_dir().to_string_lossy().to_string()),
        "config_dir" => val(crate::session::config_dir().to_string_lossy().to_string()),
        "config_default_workspace_root" => val(crate::session::default_workspace_root()
            .to_string_lossy()
            .to_string()),
        "config_read_workspaces" => block(|| Ok(crate::session::load_workspaces())).await,
        "config_write_workspaces" => {
            let a = args::<OneData<crate::session::WorkspacesFile>>(&raw)?;
            block(move || crate::session::save_workspaces(&a.data).map_err(|e| e.to_string())).await
        }
        "config_read_settings" => block(|| Ok(crate::settings::load_settings())).await,
        "config_merge_settings" => {
            let a = args::<OnePatch>(&raw)?;
            block(move || {
                let merged = crate::settings::merge_settings(&a.patch)?;
                /* web 面不镜像 web_access_start/stop,故不跟 apply_settings 起停桥 ——
                web 端写 webAccessEnabled 只落盘,不起停桥(桥生命周期归桌面端)。 */
                crate::proxy::apply_and_report(&merged);
                Ok(())
            })
            .await?;
            /* 与 relay 直写盘同款纪律:成功后广播,各面 settings store 回读磁盘,
            防跨面修改被另面持久化静默回滚(跨面丢更新)。 */
            let _ = crate::event_sink::emit(app, "settings:changed", &serde_json::json!({}));
            val(())
        }
        "quota_fetch" => {
            let a = args::<OneSpec<crate::quota::QuotaRequest>>(&raw)?;
            ser(crate::quota::quota_fetch(a.spec).await)
        }
        "quota_env_value" => {
            let a = args::<OneName>(&raw)?;
            val(crate::quota::quota_env_value(a.name))
        }
        "cli_probe" => {
            let a = args::<OneCommand>(&raw)?;
            val(crate::commands_fs::cli_probe(a.command).await)
        }
        "cli_install_run" => {
            let a = args::<CliInstallArgs>(&raw)?;
            ser(crate::commands_fs::cli_install_run(app.clone(), a.id, a.plan).await)
        }
        "plugin_scan" => ser(crate::plugins::plugin_scan().await),
        "plugin_read_file" => {
            let a = args::<PluginReadArgs>(&raw)?;
            ser(crate::plugins::plugin_read_file(a.id, a.name).await)
        }
        "plugin_archive" => ser(crate::plugins::plugin_archive(args::<OneId>(&raw)?.id).await),
        "plugin_rollback" => {
            let a = args::<PluginRollbackArgs>(&raw)?;
            ser(crate::plugins::plugin_rollback(a.id, a.file).await)
        }
        "plugin_delete" => ser(crate::plugins::plugin_delete(args::<OneId>(&raw)?.id).await),
        "wsl_info" => ser(crate::wsl::wsl_info().await),
        "wsl_remote_info" => {
            let a = args::<OneHost>(&raw)?;
            ser(crate::wsl_remote::wsl_remote_info(a.host).await)
        }
        "wsl_list_dir" => {
            let a = args::<WslListDirArgs>(&raw)?;
            ser(crate::wsl_remote_ops::wsl_list_dir(a.distro, a.path, a.host).await)
        }
        "wsl_probe_engines" => {
            let a = args::<WslProbeArgs>(&raw)?;
            ser(crate::wsl_remote_ops::wsl_probe_engines(a.distro, a.bins, a.host).await)
        }
        "wsl_exec" => {
            let a = args::<WslExecArgs>(&raw)?;
            ser(crate::wsl_remote_ops::wsl_exec(a.distro, a.script, a.host).await)
        }
        "wsl_read_file_text" => {
            let a = args::<WslReadFileArgs>(&raw)?;
            ser(
                crate::wsl_remote_ops::wsl_read_file_text(a.distro, a.path, a.max_bytes, a.host)
                    .await,
            )
        }
        "sqlite_query" => {
            let a = args::<SqliteArgs>(&raw)?;
            ser(crate::sqlite::sqlite_query(a.db_path, a.sql, a.params).await)
        }
        "sqlite_execute" => {
            let a = args::<SqliteArgs>(&raw)?;
            ser(crate::sqlite::sqlite_execute(a.db_path, a.sql, a.params).await)
        }
        "proc_communicate" => {
            let a = args::<OneSpec<crate::proc_run::ProcRunSpec>>(&raw)?;
            ser(crate::commands_fs::proc_communicate(a.spec).await)
        }
        "web_access_status" => val(crate::web::web_access::web_access_status(app.clone())),
        "remote_control_active" => val(crate::web::web_access::remote_control_active()),
        /* web_access_start/stop 桌面面控,不镜像(web 表面自己就是被控方);
        app_restart 桌面专属,同理由缺席。 */
        "web_relay_status" => val(crate::web::relay::web_relay_status(app.clone())),
        "relay_deploy_pack" => {
            let a: RelayDeployPackArgs = serde_json::from_value(raw).map_err(|e| e.to_string())?;
            val(crate::web::relay::relay_deploy_pack(a.path, a.key))
        }
        /* web_relay_start/stop、relay_deploy 桌面面控,不镜像:
        web 面自己经 relay 进出,不允许 web 端掐断/重连/改 relay。 */
        _ => Err(format!("unknown command: {cmd}")),
    }
}

#[derive(serde::Deserialize)]
struct OneText {
    text: String,
}

#[derive(serde::Deserialize)]
struct OneName {
    name: String,
}

#[derive(serde::Deserialize)]
struct OneCommand {
    command: String,
}

#[derive(serde::Deserialize)]
struct OneId {
    id: String,
}

#[derive(serde::Deserialize)]
struct OneData<T> {
    data: T,
}

#[derive(serde::Deserialize)]
struct OnePatch {
    patch: serde_json::Value,
}

#[derive(serde::Deserialize)]
struct OneSpec<T> {
    spec: T,
}

#[derive(serde::Deserialize)]
struct OneHost {
    host: crate::ssh::transport::SshHostWire,
}

#[derive(serde::Deserialize)]
struct CliInstallArgs {
    id: String,
    plan: crate::installer::InstallPlan,
}

#[derive(serde::Deserialize)]
struct PluginReadArgs {
    id: String,
    name: String,
}

#[derive(serde::Deserialize)]
struct PluginRollbackArgs {
    id: String,
    file: String,
}

#[derive(serde::Deserialize)]
struct WslListDirArgs {
    distro: String,
    path: String,
    host: Option<crate::ssh::transport::SshHostWire>,
}

#[derive(serde::Deserialize)]
struct WslProbeArgs {
    distro: String,
    bins: Vec<String>,
    host: Option<crate::ssh::transport::SshHostWire>,
}

#[derive(serde::Deserialize)]
struct WslExecArgs {
    distro: String,
    script: String,
    host: Option<crate::ssh::transport::SshHostWire>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WslReadFileArgs {
    distro: String,
    path: String,
    max_bytes: u64,
    host: Option<crate::ssh::transport::SshHostWire>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqliteArgs {
    db_path: String,
    sql: String,
    params: Vec<String>,
}

#[derive(serde::Deserialize)]
struct RelayDeployPackArgs {
    path: String,
    key: Option<String>,
}

#[cfg(test)]
mod tests {
    /// Web 桥不镜像的桌面面控/专属命令。臂表若把其中任一登记为可分发,
    /// 与 KNOWN_MIRRORED 的交集断言/重复断言不设防 —— 真防线是「桌面面控
    /// 命令一律不进本文件任何臂表」,由 review 与下方清单纪律共同守护。
    const EXCLUDED: &[&str] = &[
        "web_access_start",
        "web_access_stop",
        "web_pair_offer",
        "web_devices_list",
        "web_device_approve",
        "web_device_revoke",
        "app_restart",
        "check_update",
        "download_and_install_update",
        "relaunch_app",
        "web_relay_start",
        "web_relay_stop",
        "relay_deploy",
    ];

    /// misc 域臂表代表面(每臂一条抽样,完整清单以 match 为准)。
    /// 约束:与 EXCLUDED 无交集。臂运行时探针(传空参断言「参数错误 vs
    /// unknown」)因 AppHandle<Wry> 无法离线构造而不可行,故退守清单纪律。
    const KNOWN_MIRRORED: &[&str] = &[
        "md5_hex",
        "platform_kind",
        "config_read_settings",
        "quota_fetch",
        "cli_probe",
        "plugin_scan",
        "wsl_info",
        "sqlite_query",
        "proc_communicate",
        "web_access_status",
        "remote_control_active",
    ];

    #[test]
    fn 镜像与排除清单互斥且无重复() {
        for cmds in [KNOWN_MIRRORED, EXCLUDED] {
            for (i, a) in cmds.iter().enumerate() {
                assert!(!a.is_empty());
                for b in &cmds[i + 1..] {
                    assert_ne!(a, b, "清单内重复: {a}");
                }
            }
        }
        for known in KNOWN_MIRRORED {
            assert!(
                !EXCLUDED.contains(known),
                "{known} 同时出现在镜像与排除清单"
            );
        }
    }

    /// 线契约:config_merge_settings 的桥侧参数键必须是 `patch` ——
    /// 前端 ipc.configMergeSettings 发 `{patch}`,桌面命令签名同名;
    /// 旧整树写时代键名是 `data`,键名错位 = 浏览器 WebUI 写设置静默反序列化失败。
    #[test]
    fn merge臂线契约_patch键() {
        use super::{args, OnePatch};
        let ok: OnePatch = args(&serde_json::json!({ "patch": { "theme": "dark" } })).unwrap();
        assert_eq!(ok.patch["theme"], "dark");
        assert!(args::<OnePatch>(&serde_json::json!({ "data": {} })).is_err());
    }
}
