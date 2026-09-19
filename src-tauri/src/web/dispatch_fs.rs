//! fs 域命令桥(目录/文件/索引)。命令名与参数键逐一对齐 kernel/ipc.ts 的 invoke 调用。

use std::future::Future;

use serde_json::Value;
use tauri::AppHandle;

use super::dispatch::{args, ser};

pub(super) async fn try_dispatch(
    _app: &AppHandle,
    cmd: &str,
    raw: &Value,
) -> Option<Result<Value, String>> {
    Some(match cmd {
        "fs_list_dir" => go(raw, |a: OnePath| crate::commands_fs::fs_list_dir(a.path)).await,
        "fs_read_file" => go(raw, |a: OnePath| crate::commands_fs::fs_read_file(a.path)).await,
        "fs_write_temp" => {
            go(raw, |a: WriteTemp| {
                crate::commands_fs::fs_write_temp(a.name, a.data)
            })
            .await
        }
        "fs_collect_files" => {
            go(raw, |a: Collect| {
                crate::commands_fs::fs_collect_files(a.dir, a.suffix)
            })
            .await
        }
        "fs_read_head" => {
            go(raw, |a: ReadSpan| {
                crate::commands_fs::fs_read_head(a.path, a.max_bytes)
            })
            .await
        }
        "fs_read_tail" => {
            go(raw, |a: ReadSpan| {
                crate::commands_fs::fs_read_tail(a.path, a.max_bytes)
            })
            .await
        }
        "fs_remove_path" => go(raw, |a: OnePath| crate::commands_fs::fs_remove_path(a.path)).await,
        "fs_walk_files" => {
            go(raw, |a: Walk| {
                crate::commands_fs::fs_walk_files(a.root, a.cap)
            })
            .await
        }
        "fs_write_file" => {
            go(raw, |a: WriteFile| {
                crate::fs_edit::fs_write_file(a.path, a.content)
            })
            .await
        }
        "fs_create_file" => go(raw, |a: OnePath| crate::fs_edit::fs_create_file(a.path)).await,
        "fs_create_dir" => go(raw, |a: OnePath| crate::fs_edit::fs_create_dir(a.path)).await,
        "fs_rename_entry" => {
            go(raw, |a: Rename| {
                crate::fs_edit::fs_rename_entry(a.path, a.new_name)
            })
            .await
        }
        "fs_trash_entry" => go(raw, |a: OnePath| crate::fs_edit::fs_trash_entry(a.path)).await,
        "fs_reveal_in_file_manager" => {
            go(raw, |a: OnePath| {
                crate::fs_edit::fs_reveal_in_file_manager(a.path)
            })
            .await
        }
        "fs_copy_file" => go(raw, |a: Copy| crate::fs_edit::fs_copy_file(a.src, a.dst)).await,
        "read_binary_file_base64" => {
            go(raw, |a: OnePath| {
                crate::commands_fs::read_binary_file_base64(a.path)
            })
            .await
        }
        _ => return None,
    })
}

async fn go<A: serde::de::DeserializeOwned, T, F, Fut>(raw: &Value, f: F) -> Result<Value, String>
where
    F: FnOnce(A) -> Fut,
    Fut: Future<Output = Result<T, String>>,
    T: serde::Serialize,
{
    ser(f(args::<A>(raw)?).await)
}

#[derive(serde::Deserialize)]
struct OnePath {
    path: String,
}

#[derive(serde::Deserialize)]
struct WriteTemp {
    name: String,
    data: Vec<u8>,
}

#[derive(serde::Deserialize)]
struct Collect {
    dir: String,
    suffix: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadSpan {
    path: String,
    max_bytes: usize,
}

#[derive(serde::Deserialize)]
struct Walk {
    root: String,
    cap: usize,
}

#[derive(serde::Deserialize)]
struct WriteFile {
    path: String,
    content: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rename {
    path: String,
    new_name: String,
}

#[derive(serde::Deserialize)]
struct Copy {
    src: String,
    dst: String,
}
