//! 批次 diff —— 旧像(anchor A)与新像(anchor B / live)逐路径 patch。
//!
//! 实现:两侧内容物化进 sidecar(内容寻址,重复免写),Patch::from_blob_and_blob
//! 生成 unified 文本。patch 头无文件路径(blob 无路径语义),文件名由前端分区头渲染。

use super::{batch_paths, load_manifests, open_sidecar, resolve_snap_bytes, write_sidecar_blob, CkptError};
use git2::DiffOptions;
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CkptPatch {
    pub path: String,
    /// A(新增)| D(批内删除)| M
    pub kind: String,
    pub additions: u32,
    pub deletions: u32,
    /// unified diff 文本;binary 为空串
    pub patch: String,
    pub binary: bool,
}

/// 指定批次(anchorA id)的逐文件 patch。仅 sealed 批;open 批前端复用 git 面板的
/// git_diff_file_patch(工作区 diff ≈ 本批 diff:A 时干净的路径两边一致)。
pub fn batch_patches(cwd: &str, batch_id: &str) -> Result<Vec<CkptPatch>, CkptError> {
    let manifests = load_manifests(cwd);
    let anchors: Vec<&super::Snapshot> = manifests.iter().filter(|s| s.kind == "anchor").collect();
    let ai = anchors
        .iter()
        .position(|s| s.id == batch_id)
        .ok_or_else(|| CkptError::Empty(format!("批次不存在: {batch_id}")))?;
    let a = anchors[ai];
    let b = anchors.get(ai + 1).copied().ok_or_else(|| {
        CkptError::Empty("进行中批次无批后像,请用 git 面板查看工作区 diff".into())
    })?;

    let sidecar = open_sidecar(cwd)?;
    let user = super::open_user(cwd)?;
    {
        let live = super::capture::dirty_paths(&user)?;
        let Some(paths) = batch_paths(a, Some(b), false, &live) else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        for (path, _) in paths {
            // 旧像:A;新像:B(缺条目 = B 时已干净 → HEAD 兜底)
            let old = resolve_snap_bytes(&sidecar, &user, a, &path)?;
            let new = resolve_snap_bytes(&sidecar, &user, b, &path)?;
            let (kind, old_blob, new_blob) = match (&old, &new) {
                (None, Some(_)) => ("A", None, Some(new.as_ref().unwrap().0.as_slice())),
                (Some(_), None) => ("D", Some(old.as_ref().unwrap().0.as_slice()), None),
                (None, None) => continue, // 两侧皆无内容(如双方都是 skip 文件)
                (Some(o), Some(n)) => {
                    if o.0 == n.0 {
                        continue; // 已回退/内容一致 → 无差异
                    }
                    ("M", Some(o.0.as_slice()), Some(n.0.as_slice()))
                }
            };
            let old_oid = old_blob.map(|d| write_sidecar_blob(&sidecar, d)).transpose()?;
            let new_oid = new_blob.map(|d| write_sidecar_blob(&sidecar, d)).transpose()?;
            let ob = old_oid.map(|o| sidecar.find_blob(git2::Oid::from_str(&o)?)).transpose()?;
            let nb = new_oid.map(|o| sidecar.find_blob(git2::Oid::from_str(&o)?)).transpose()?;
            let binary = ob.as_ref().is_some_and(is_binary) || nb.as_ref().is_some_and(is_binary);

            let (patch, adds, dels) = if binary {
                (String::new(), 0, 0)
            } else {
                // 缺侧(新增/删除)用空 blob 顶位;路径喂给 patch 头,前端分区头仍自己渲染
                let empty = sidecar.blob(b"")?;
                let empty = sidecar.find_blob(empty)?;
                let obf = ob.as_ref().unwrap_or(&empty);
                let nbf = nb.as_ref().unwrap_or(&empty);
                let mut opts = DiffOptions::new();
                opts.context_lines(3).interhunk_lines(0);
                let mut p = git2::Patch::from_blobs(
                    obf,
                    Some(std::path::Path::new(&format!("a/{path}"))),
                    nbf,
                    Some(std::path::Path::new(&format!("b/{path}"))),
                    Some(&mut opts),
                )?;
                let (_ctx, a, d) = p.line_stats()?;
                (String::from_utf8_lossy(&p.to_buf()?).into_owned(), a as u32, d as u32)
            };
            out.push(CkptPatch {
                path,
                kind: kind.into(),
                additions: adds,
                deletions: dels,
                patch,
                binary,
            });
        }
        Ok(out)
    }
}

/// libgit2 的 binary 判定同款:前 8000 字节含 NUL。
fn is_binary(b: &git2::Blob) -> bool {
    b.content().iter().take(8000).any(|&c| c == 0)
}
