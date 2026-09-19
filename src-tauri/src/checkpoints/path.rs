//! 事件路径规范化 —— 审批线接收 AI 写入事件路径的唯一闸。
//!
//! 两级形态:
//! - 工作区内(相对路径):纪律与初版逐字一致(空 / 父级逃逸即拒),原文存储
//!   不重写 —— 既有工作区内账本行为不变是硬约束。
//! - 工作区外(绝对路径):词法归一(`.` 消除、`..` 弹一层,根处越界截断)后
//!   存绝对形态;`~/` 由本闸展开(home 必在工作区外),`~other` 形式拒;
//!   Windows 盘符(`C:\…` / `C:/…`)与 UNC(`\\…`)归一为斜杠后同分支入账,
//!   存盘符形态 —— 2026-09-15 win 宿主实证:omp/pi 的 hashline 头与 write
//!   resolvedPath 在 Windows 全是盘符绝对路径,拒收 = events 归因全盲;cwd 内
//!   相对化由前端 normalizeEditPath 承担(它持有 cwd),本闸只认形态。
//!
//! 事件文本来自 CLI 输出 / 会话 JSONL,不可信:本闸之后不再设第二道检查。
//! `root.join(绝对路径)` = 绝对路径本身,账本全部 IO 点(apply/restore/diff/
//! seal/guard)对外部路径因此天然正确,无需逐点改造。
//! (盘符绝对路径经 root.join 在 Windows 上整体替换为绝对路径 —— 工作区外
//! 语义恰为所需;非 Windows 宿主上仅测试构造会出现此形态,不参与生产 IO。)

/// 路径是否工作区外(绝对):POSIX 绝对 / Windows 盘符 / UNC 双斜杠。
pub(crate) fn is_external_path(p: &str) -> bool {
    p.starts_with('/') || is_win_drive_path(p)
}

/// Windows 盘符形态(`C:…`,含历史残片;完整绝对形态由调用方保证带分隔符)。
fn is_win_drive_path(p: &str) -> bool {
    p.len() >= 2 && p.as_bytes()[1] == b':' && p.as_bytes()[0].is_ascii_alphabetic()
}

/// 事件路径 → 账本存储形态;不可信 / 不可解析返回 None。
pub(crate) fn canonicalize_event_path(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    // Windows 绝对形态(盘符/UNC):反斜杠统一为斜杠后按绝对路径归一,存
    // 盘符/UNC 形态(root.join 遇盘符绝对路径整体替换,工作区 IO 语义不变)
    let unified;
    let p = if is_win_drive_path(raw) || raw.starts_with("\\\\") {
        unified = raw.replace('\\', "/");
        unified.as_str()
    } else {
        raw
    };
    // ~/ 展开为绝对路径;裸 ~ 与 ~other 形式不可解析,拒
    let home_expanded;
    let p = if let Some(rest) = p.strip_prefix("~/") {
        if rest.is_empty() {
            return None;
        }
        let home = dirs::home_dir()?;
        // win 宿主 home 带反斜杠,展开后与盘符形态同规(斜杠统一)
        home_expanded = format!(
            "{}/{}",
            home.to_string_lossy()
                .trim_end_matches('/')
                .replace('\\', "/"),
            rest
        );
        home_expanded.as_str()
    } else if p.starts_with('~') {
        return None;
    } else {
        p
    };
    if is_external_path(p) {
        let drive_root = is_win_drive_path(p);
        // 工作区外:词法归一(. 消除;.. 弹一层,根处越界截断 —— 绝对路径无逃逸)。
        // 盘符形态预置盘符段作根,".." 不得弹出(否则 C:/../x 会塌缩成相对形态,
        // 被工作区内分支误收);POSIX "/" 与 UNC "//" 各保留原头。
        let mut segs: Vec<&str> = Vec::new();
        let mut iter = p.split('/');
        if drive_root {
            segs.push(iter.next().unwrap()); // 首段即盘符,只计一次
        }
        for seg in iter {
            match seg {
                "" | "." => {}
                ".." => {
                    if segs.len() > usize::from(drive_root) {
                        segs.pop();
                    }
                }
                s => segs.push(s),
            }
        }
        if segs.len() <= usize::from(drive_root) {
            return None; // "/" 或 "C:/" 归一后无文件分量 = 非文件路径
        }
        let prefix = if p.starts_with("//") {
            "//"
        } else if drive_root {
            ""
        } else {
            "/"
        };
        return Some(format!("{}{}", prefix, segs.join("/")));
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
