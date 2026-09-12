//! 事件路径规范化 —— 审批线接收 AI 写入事件路径的唯一闸。
//!
//! 两级形态:
//! - 工作区内(相对路径):纪律与初版逐字一致(空 / 父级逃逸即拒),原文存储
//!   不重写 —— 既有工作区内账本行为不变是硬约束。
//! - 工作区外(绝对路径):词法归一(`.` 消除、`..` 弹一层,根处越界截断)后
//!   存绝对形态;`~/` 由本闸展开(home 必在工作区外),`~other` 形式拒。
//!
//! 事件文本来自 CLI 输出 / 会话 JSONL,不可信:本闸之后不再设第二道检查。
//! `root.join(绝对路径)` = 绝对路径本身,账本全部 IO 点(apply/restore/diff/
//! seal/guard)对外部路径因此天然正确,无需逐点改造。
//! (Windows 盘符形态在本闸显式拒收:若放行,工作区内分支会把它当相对路径存,
//! root.join 在 Windows 上被盘符路径整体替换为绝对路径,工作区内外判定失效、防误删失守。)

/// 路径是否工作区外(绝对)。
pub(crate) fn is_external_path(p: &str) -> bool {
    p.starts_with('/')
}

/// 事件路径 → 账本存储形态;不可信 / 不可解析返回 None。
pub(crate) fn canonicalize_event_path(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    // Windows 盘符形态(C:\… / C:/…)两态都不收:单闸终审,不依赖前端已拒
    if raw.len() >= 2 && raw.as_bytes()[1] == b':' && raw.as_bytes()[0].is_ascii_alphabetic() {
        return None;
    }
    // ~/ 展开为绝对路径;裸 ~ 与 ~other 形式不可解析,拒
    let home_expanded;
    let p = if let Some(rest) = raw.strip_prefix("~/") {
        if rest.is_empty() {
            return None;
        }
        let home = dirs::home_dir()?;
        home_expanded = format!("{}/{}", home.to_string_lossy().trim_end_matches('/'), rest);
        home_expanded.as_str()
    } else if raw.starts_with('~') {
        return None;
    } else {
        raw
    };
    if is_external_path(p) {
        // 工作区外:词法归一(. 消除;.. 弹出一层,根处越界截断 —— 绝对路径无逃逸)
        let mut segs: Vec<&str> = Vec::new();
        for seg in p.split('/') {
            match seg {
                "" | "." => {}
                ".." => {
                    segs.pop();
                }
                s => segs.push(s),
            }
        }
        if segs.is_empty() {
            return None; // "/" 归一后无分量 = 非文件路径
        }
        return Some(format!("/{}", segs.join("/")));
    }
    // 工作区内相对路径:与初版逐字一致的纪律(任何父级分量即拒),原文存储
    if std::path::Path::new(p)
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return None;
    }
    Some(p.to_string())
}
