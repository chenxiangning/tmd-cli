//! 精准手术擦除 —— 自 restore.rs 拆出(文件规模铁则),与 apply.rs 的「精准
//! 重放」对称:只擦本批 hunk,他人并行写入的行保留。

/// 失配路径的精准手术:M/A 文件尝试按 diff 擦除本批改动 —— M 以批前像为基线,
/// A(批内新建)以空内容为基线(old 块 = 批后全文,live 中唯一命中即摘除,
/// 他人前后追加保留)。返回 Ok(Some(merged)) = 手术成功;Ok(None) = 与他人
/// 改动重叠/歧义冲突;Err(()) = 不具备手术条件(D 文件、前像缺失/不可解析),
/// 走保守跳过。
pub(super) fn surgical_erase(
    sidecar: &git2::Repository,
    tf: &super::TurnFile,
    after: Option<&Vec<u8>>,
    live: Option<&Vec<u8>>,
) -> Result<Option<Vec<u8>>, ()> {
    let (Some(a), Some(l)) = (after, live) else {
        return Err(());
    };
    // A 文件(批内新建)基线 = 空;M 文件取批前像 blob,缺失/不可解析 = 无条件
    let before: Vec<u8> = if !tf.existed_before {
        Vec::new()
    } else if tf.before_oid.is_empty() {
        return Err(());
    } else {
        let Ok(oid) = git2::Oid::from_str(&tf.before_oid) else {
            return Err(());
        };
        let Ok(blob) = sidecar.find_blob(oid) else {
            return Err(());
        };
        blob.content().to_vec()
    };
    super::patch::merge_patch(l, a, &before).map(Some).ok_or(())
}
