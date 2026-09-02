//! 快照抓取 —— 用户仓库 dirty 路径枚举 + 工作区内容入 sidecar。
//!
//! 只写 blob,不触碰用户仓库的 index/refs;O(变动集) 成本:clean 路径不存
//! (前像由 base_oid/HEAD 兜底,见 mod.rs resolve_snap_bytes)。

use super::{new_snapshot_id, append_manifest, open_sidecar, write_sidecar_blob, CkptError, Snapshot, SnapFile, MAX_FILE_BYTES};
use std::collections::BTreeMap;

/// anchor(用户消息锚点)| guard(回退前守卫)。
#[derive(Clone, Copy, PartialEq)]
pub enum SnapKind {
    Anchor,
    Guard,
}

impl SnapKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Anchor => "anchor",
            Self::Guard => "guard",
        }
    }
}

/// 用户仓库当前 dirty 路径集(路径 → 展示状态符,untracked = "?")。
/// 含 untracked、含 staged-only、不含 ignored;冲突路径标 "C" 且调用方跳过存内容。
pub fn dirty_paths(
    repo: &git2::Repository,
) -> Result<BTreeMap<String, String>, git2::Error> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false)
        .exclude_submodules(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let mut map = BTreeMap::new();
    for s in statuses.iter() {
        let path = String::from_utf8_lossy(s.path_bytes()).into_owned();
        let st = s.status();
        let ch = if st.is_conflicted() {
            "C"
        } else if st.is_wt_new() || st.is_index_new() {
            "A"
        } else if st.is_wt_deleted() || st.is_index_deleted() {
            "D"
        } else if st.is_wt_renamed() || st.is_index_renamed() {
            "R"
        } else if st.is_wt_typechange() || st.is_index_typechange() {
            "T"
        } else {
            "M"
        };
        map.insert(path, ch.to_string());
    }
    Ok(map)
}

/// 抓一份快照:枚举 dirty 路径 → 逐个读工作区 → blob 入 sidecar → 追加 manifest。
/// capture 失败向上传播,由 commands 层决定"不阻塞发送"的重试/降级策略。
pub fn capture_snapshot(
    cwd: &str,
    session_id: &str,
    prompt: &str,
    kind: SnapKind,
) -> Result<Snapshot, CkptError> {
    // 1. 用户仓库:dirty 集 + index 基线 oid(git 侧前像)
    let user = super::open_user(cwd)?;
    let dirty = dirty_paths(&user)?;
    let mut index = user.index()?;
    index.read(true)?;
    let mut bases: BTreeMap<String, String> = BTreeMap::new();
    for p in dirty.keys() {
        let base = index
            .get_path(std::path::Path::new(p), 0)
            .map(|e| e.id.to_string())
            .unwrap_or_default();
        bases.insert(p.clone(), base);
    }

    // 2. 工作区内容 → sidecar blob
    let sidecar = open_sidecar(cwd)?;
    let root = std::path::PathBuf::from(cwd);
    let mut files = Vec::with_capacity(dirty.len());
    for (path, status) in &dirty {
        let full = root.join(path);
        let base_oid = bases.get(path).cloned().unwrap_or_default();

        // 冲突态内容不可信,跳过存内容(状态照记,UI 可见)
        if status == "C" {
            files.push(SnapFile {
                path: path.clone(),
                oid: String::new(),
                base_oid,
                existed: true,
                bytes: 0,
                skip: Some("合并冲突".into()),
                status: status.clone(),
            });
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&full) else {
            // 状态说 dirty 但文件没了 = 工作区删除:记 existed=false,前像走 base_oid
            files.push(SnapFile {
                path: path.clone(),
                oid: String::new(),
                base_oid,
                existed: false,
                bytes: 0,
                skip: None,
                status: status.clone(),
            });
            continue;
        };
        if meta.is_symlink() {
            files.push(SnapFile {
                path: path.clone(),
                oid: String::new(),
                base_oid,
                existed: true,
                bytes: 0,
                skip: Some("符号链接".into()),
                status: status.clone(),
            });
            continue;
        }
        if meta.len() > MAX_FILE_BYTES {
            files.push(SnapFile {
                path: path.clone(),
                oid: String::new(),
                base_oid,
                existed: true,
                bytes: meta.len(),
                skip: Some("超过 2MiB".into()),
                status: status.clone(),
            });
            continue;
        }
        match std::fs::read(&full) {
            Ok(bytes) => {
                let oid = write_sidecar_blob(&sidecar, &bytes)?;
                files.push(SnapFile {
                    path: path.clone(),
                    oid,
                    base_oid,
                    existed: true,
                    bytes: bytes.len() as u64,
                    skip: None,
                    status: status.clone(),
                });
            }
            Err(e) => files.push(SnapFile {
                path: path.clone(),
                oid: String::new(),
                base_oid,
                existed: true,
                bytes: 0,
                skip: Some(format!("读取失败: {e}")),
                status: status.clone(),
            }),
        }
    }

    // 3. manifest 落盘(prompt 截断存摘要,全文归前端锚点栏设施)
    let snap = Snapshot {
        id: new_snapshot_id(super::now_millis()),
        ts: super::now_millis(),
        kind: kind.as_str().to_string(),
        session_id: session_id.to_string(),
        prompt: prompt.chars().take(4000).collect(),
        files,
    };
    append_manifest(cwd, &snap)?;
    Ok(snap)
}
