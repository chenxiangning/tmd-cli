//! 存储体检 —— 只读目录占用统计(存储管家插件的数据面)。
//!
//! 配方沿用 git::commands_worktree::dir_size(手写递归、不跟符号链接、
//! 个别项读不到按 0 计),两点不同:跳过目录名由调用方传入(checkpoints
//! 的 objects.git 是正式数据,命令不得硬编码跳 .git),且同时累计文件数。
//! 单类目 20s 超时保护:超时类目标 timed_out 返回,不拖垮整批
//! (spawn_blocking 任务本身不可取消,超时后后台自然跑完即弃)。

use serde::{Deserialize, Serialize};

/// 体检目标。skip_dir_names:递归中按目录名整枝跳过(任意层级)。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirUsageSpec {
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub skip_dir_names: Vec<String>,
}

/// 单类目结果。timed_out = 20s 内没算完(占用未知,与「未使用」是两回事)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirUsageReport {
    pub label: String,
    pub bytes: u64,
    pub files: u64,
    pub timed_out: bool,
}

/// 单类目上限:正常目录远小于此,兜住异常挂载点(网络盘/死循环软链已另防)。
const SPEC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// 递归累计(字节,文件数)。符号链接不跟随(防环);单项读不到按 0 计
/// (占用统计不因权限/竞态整体失败);目录不存在回零。
fn dir_usage(path: &std::path::Path, skip: &[String]) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let Ok(rd) = std::fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let p = entry.path();
        if ft.is_dir() {
            let name = entry.file_name();
            if name.to_str().is_some_and(|n| skip.iter().any(|s| s == n)) {
                continue;
            }
            let (b, f) = dir_usage(&p, skip);
            bytes += b;
            files += f;
        } else if let Ok(m) = entry.metadata() {
            bytes += m.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// 批量体检:每类目独立 spawn_blocking + 超时,互不拖累;结果按入参顺序回。
/// 超时各自包好再 join_all:逐个 await 时第 k 个挂死类目独占 20s 串行窗
/// (12 类目全挂 = 240s,面板卡「体检中」),「单类目 20s」语义失真。
/// JoinError(spawn_blocking panic)按超时同款入表,不拖垮整批。
#[tauri::command]
pub(crate) async fn fs_dir_usage(specs: Vec<DirUsageSpec>) -> Result<Vec<DirUsageReport>, String> {
    let mut timed = Vec::with_capacity(specs.len());
    for spec in specs {
        let label = spec.label.clone();
        let task = tauri::async_runtime::spawn_blocking(move || {
            let (bytes, files) = dir_usage(std::path::Path::new(&spec.path), &spec.skip_dir_names);
            DirUsageReport {
                label: spec.label,
                bytes,
                files,
                timed_out: false,
            }
        });
        timed.push((label, tokio::time::timeout(SPEC_TIMEOUT, task)));
    }
    let labels: Vec<String> = timed.iter().map(|(l, _)| l.clone()).collect();
    let settled = futures_util::future::join_all(timed.into_iter().map(|(_, t)| t)).await;
    let mut out = Vec::with_capacity(settled.len());
    for (label, r) in labels.into_iter().zip(settled) {
        match r {
            Ok(Ok(report)) => out.push(report),
            Ok(Err(_)) | Err(_) => out.push(DirUsageReport {
                label,
                bytes: 0,
                files: 0,
                timed_out: true,
            }),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::dir_usage;

    fn tmp_root(tag: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("tmd-cli-dirusage-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn 多类目各算各的_嵌套与文件数正确() {
        /* 类目一:checkpoints 形态(objects.git 是正式数据,必须计入)。 */
        let ck = tmp_root("ck");
        std::fs::create_dir_all(ck.join("objects.git")).unwrap();
        std::fs::write(ck.join("objects.git/blob"), vec![0u8; 1000]).unwrap();
        std::fs::write(ck.join("ledger.jsonl"), vec![0u8; 200]).unwrap();
        /* 类目二:CLI 会话目录形态(嵌套层级)。 */
        let sessions = tmp_root("sessions");
        std::fs::create_dir_all(sessions.join("a/b")).unwrap();
        std::fs::write(sessions.join("a/b/s.jsonl"), vec![0u8; 50]).unwrap();
        std::fs::write(sessions.join("t.jsonl"), vec![0u8; 70]).unwrap();

        assert_eq!(dir_usage(&ck, &[]), (1200, 2));
        assert_eq!(dir_usage(&sessions, &[]), (120, 2));

        let _ = std::fs::remove_dir_all(&ck);
        let _ = std::fs::remove_dir_all(&sessions);
    }

    #[test]
    fn 符号链接不跟随() {
        let root = tmp_root("symlink");
        std::fs::write(root.join("own.txt"), vec![0u8; 10]).unwrap();
        let outside = tmp_root("outside");
        std::fs::write(outside.join("big"), vec![0u8; 9999]).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();

        assert_eq!(dir_usage(&root, &[]), (10, 1));

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn skip目录名生效_任意层级() {
        let root = tmp_root("skip");
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("node_modules/pkg/x.js"), vec![0u8; 500]).unwrap();
        std::fs::create_dir_all(root.join("deep/node_modules")).unwrap();
        std::fs::write(root.join("deep/node_modules/y.js"), vec![0u8; 400]).unwrap();
        std::fs::write(root.join("keep.txt"), vec![0u8; 30]).unwrap();

        assert_eq!(dir_usage(&root, &["node_modules".to_string()]), (30, 1));
        assert_eq!(dir_usage(&root, &[]), (930, 3));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn 不存在路径回零() {
        let missing = std::env::temp_dir().join("tmd-cli-dirusage-不存在-占位");
        assert_eq!(dir_usage(&missing, &[]), (0, 0));
    }
}
