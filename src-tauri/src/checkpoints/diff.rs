//! 批次 diff —— 旧像/新像字节对逐路径 unified patch。
//!
//! 实现:两侧内容物化进 sidecar(内容寻址,重复免写),Patch::from_blob_and_blob
//! 生成 unified 文本。patch 头无文件路径(blob 无路径语义),文件名由前端分区头渲染。
//! 封口落账(ledger)与 open 批 live diff 共用同一原语。

use super::{open_sidecar, write_sidecar_blob, CkptError};
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

/// 单路径 patch:old = 批前像,new = 批后像(None = 该侧不存在)。
/// 两侧等值由调用方先行短路(等值即无变更,不入批)。
pub fn blob_patch(
    sidecar: &git2::Repository,
    path: &str,
    old: Option<&[u8]>,
    new: Option<&[u8]>,
) -> Result<CkptPatch, CkptError> {
    let kind = match (old, new) {
        (None, Some(_)) => "A",
        (Some(_), None) => "D",
        _ => "M",
    };
    let old_oid = old.map(|d| write_sidecar_blob(sidecar, d)).transpose()?;
    let new_oid = new.map(|d| write_sidecar_blob(sidecar, d)).transpose()?;
    let ob = old_oid
        .map(|o| sidecar.find_blob(git2::Oid::from_str(&o)?))
        .transpose()?;
    let nb = new_oid
        .map(|o| sidecar.find_blob(git2::Oid::from_str(&o)?))
        .transpose()?;
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
        (
            String::from_utf8_lossy(&p.to_buf()?).into_owned(),
            a as u32,
            d as u32,
        )
    };
    Ok(CkptPatch {
        path: path.to_string(),
        kind: kind.into(),
        additions: adds,
        deletions: dels,
        patch,
        binary,
    })
}

/// libgit2 的 binary 判定同款:前 8000 字节含 NUL。
fn is_binary(b: &git2::Blob) -> bool {
    b.content().iter().take(8000).any(|&c| c == 0)
}

/// open 批(进行中)diff:anchor 基线 → live 工作区。文件列表由调用方给出
/// (ledger::open_turn_paths 的归因结果),这里只负责逐路径出 patch。
pub fn open_batch_patches(
    cwd: &str,
    anchor_files: &[super::SnapFile],
    paths: &[String],
) -> Result<Vec<CkptPatch>, CkptError> {
    let sidecar = open_sidecar(cwd)?;
    let user = super::open_user(cwd)?;
    let root = std::path::PathBuf::from(cwd);
    let mut out = Vec::new();
    for path in paths {
        let old = super::resolve_snap_bytes(&sidecar, Some(&user), anchor_files, path)?;
        let new = std::fs::read(root.join(path)).ok().map(|d| (d, true));
        let (old, new) = match (old, new) {
            (None, None) => continue, // 两侧皆无内容(如双方都是 skip 文件)
            (o, n) => (o.map(|b| b.0), n.map(|b| b.0)),
        };
        if old == new {
            continue; // 已回退/内容一致 → 无差异
        }
        out.push(blob_patch(&sidecar, path, old.as_deref(), new.as_deref())?);
    }
    Ok(out)
}
