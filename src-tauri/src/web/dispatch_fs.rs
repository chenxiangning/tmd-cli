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
        "fs_read_heads" => {
            go(raw, |a: ReadHeads| {
                crate::commands_fs::fs_read_heads(a.paths, a.max_bytes)
            })
            .await
        }
        "fs_read_tail" => {
            go(raw, |a: ReadSpan| {
                crate::commands_fs::fs_read_tail(a.path, a.max_bytes)
            })
            .await
        }
        "fs_read_range" => {
            go(raw, |a: ReadRange| {
                crate::commands_fs::fs_read_range(a.path, a.start, a.max_bytes)
            })
            .await
        }
        "fs_read_tail_changed" => {
            go(raw, |a: TailChanged| {
                crate::commands_fs::fs_read_tail_changed(a.path, a.max_bytes, a.last_size)
            })
            .await
        }
        "fs_remove_path" => go(raw, |a: OnePath| crate::commands_fs::fs_remove_path(a.path)).await,
        "fs_search" => {
            go(raw, |a: Search| {
                crate::commands_fs::fs_search(a.root, a.query, a.case_sensitive, a.max_results)
            })
            .await
        }
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
#[serde(rename_all = "camelCase")]
struct ReadRange {
    path: String,
    start: u64,
    max_bytes: usize,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadHeads {
    paths: Vec<String>,
    max_bytes: usize,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TailChanged {
    path: String,
    max_bytes: usize,
    last_size: Option<u64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Search {
    root: String,
    query: String,
    case_sensitive: bool,
    max_results: usize,
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

/* IPC 参数 struct 的 serde 契约(2026-10-05 真机三连炸防线):webview/桥两侧
 * JSON 一律 camelCase(ipc.ts),任何多词字段 struct 漏 rename_all 只会在真机
 * 反序列化时炸(桩/mock 均不过 serde)。本组测试把「camelCase JSON 必须成功
 * 反序列化」钉成本地红绿,新增参数 struct 须在此登记一行。 */
#[cfg(test)]
mod serde_contract_tests {
    use super::*;

    #[test]
    fn fs域参数结构体接受小驼峰() {
        /* 多词字段 struct(rename_all 消费方) */
        serde_json::from_str::<ReadSpan>(r#"{"path":"/a","maxBytes":10}"#).unwrap();
        serde_json::from_str::<ReadRange>(r#"{"path":"/a","start":0,"maxBytes":10}"#).unwrap();
        serde_json::from_str::<ReadHeads>(r#"{"paths":[],"maxBytes":10}"#).unwrap();
        serde_json::from_str::<TailChanged>(r#"{"path":"/a","maxBytes":10,"lastSize":null}"#)
            .unwrap();
        serde_json::from_str::<Rename>(r#"{"path":"/a","newName":"b"}"#).unwrap();
        /* 单词字段 struct(无 rename 差异,一并钉住形状漂移) */
        serde_json::from_str::<OnePath>(r#"{"path":"/a"}"#).unwrap();
        serde_json::from_str::<WriteTemp>(r#"{"name":"n","data":[]}"#).unwrap();
        serde_json::from_str::<Collect>(r#"{"dir":"/d","suffix":".jsonl"}"#).unwrap();
        serde_json::from_str::<WriteFile>(r#"{"path":"/a","content":"x"}"#).unwrap();
        serde_json::from_str::<Copy>(r#"{"src":"/a","dst":"/b"}"#).unwrap();
    }

    #[test]
    fn 多词字段缺小驼峰必须报错() {
        /* 漏 rename_all 的 struct 会在这里以 missing field 炸 —— 与真机同症状。 */
        assert!(serde_json::from_str::<ReadSpan>(r#"{"path":"/a","max_bytes":10}"#).is_err());
        assert!(
            serde_json::from_str::<ReadRange>(r#"{"path":"/a","start":0,"max_bytes":10}"#).is_err()
        );
    }
}
