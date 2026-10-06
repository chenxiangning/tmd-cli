//! git_status_batch —— 多仓 status 批量命令(文件树 git 着色专用,
//! 2026-10-06 自 commands.rs 拆出:文件规模铁则)。

use git2::Repository;

use super::{status, DiffStatus, GitError};

/// 批量行:失败仓直接省略(消费侧按「拿到即有效」合并,对齐旧逐仓
/// allSettled fulfilled-only 语义)。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStatusRow {
    pub root: String,
    pub status: DiffStatus,
}

/// thread::scope 逐仓一线程并行,消灭 JS 侧 N 次 invoke 往返;不走
/// with_repo 缓存(repos_scan 同款先例 —— 批仓各自独立打开,无重复开仓增益)。
#[tauri::command]
pub async fn git_status_batch(cwds: Vec<String>) -> Result<Vec<BatchStatusRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let rows = std::sync::Mutex::new(Vec::with_capacity(cwds.len()));
        let rows_ref = &rows;
        std::thread::scope(|s| {
            for cwd in &cwds {
                let cwd = cwd.clone();
                s.spawn(move || {
                    let row = Repository::open(&cwd)
                        .map_err(GitError::from)
                        .and_then(|repo| status::compute(&repo))
                        .ok()
                        .map(|status| BatchStatusRow {
                            root: cwd.clone(),
                            status,
                        });
                    if let Some(row) = row {
                        rows_ref.lock().expect("batch rows").push(row);
                    }
                });
            }
        });
        rows.into_inner().expect("batch rows")
    })
    .await
    .map_err(|e| format!("E_GIT2: 任务调度失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::super::tests_common::TempRepo;

    #[test]
    fn 批量_成功仓返回_失败仓省略() {
        let good = TempRepo::new();
        good.write("a.txt", "x\n");
        /* TempRepo 自带 init;非仓路径用裸目录构造。 */
        let bogus_dir =
            std::env::temp_dir().join(format!("tmd-git-notrepo-{}", std::process::id()));
        std::fs::create_dir_all(&bogus_dir).unwrap();
        let bogus = bogus_dir.to_str().unwrap().to_string();
        let out = tokio::runtime::Runtime::new()
            .expect("rt")
            .block_on(super::git_status_batch(vec![
                bogus,
                good.path().to_string(),
            ]))
            .expect("batch ok");
        assert_eq!(out.len(), 1, "非仓路径必须整行省略");
        assert_eq!(out[0].root, good.path());
        assert_eq!(out[0].status.branch, "master");
        assert!(out[0].status.files.iter().any(|f| f.path == "a.txt"));
    }
}
