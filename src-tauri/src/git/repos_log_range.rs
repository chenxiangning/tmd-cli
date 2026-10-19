//! repos_log_range —— 日期窗多仓提交清单(footprint Git 硬证据区)。
//! 复用 repos_scan 的发现先例(root 自身是仓排首位,32 上限截断);
//! 每仓 git2 revwalk 按 committer 时间窗 [since, until] 过滤(ISO,UTC 口径);
//! thread::scope 逐仓一线程并行(对齐 git_status_batch),单仓失败整仓省略。

use std::sync::Mutex;

use git2::Repository;
use serde::Serialize;

use super::GitError;

/// 发现深度:与前端 gitReposScan 默认一致。
const SCAN_DEPTH: u32 = 2;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RangeCommit {
    /// 相对 root 的仓路径(root 自身为 ".")
    pub repo: String,
    pub hash: String,
    /// commit message 首行
    pub subject: String,
    /// committer 时间,UTC ISO(`YYYY-MM-DDTHH:MM:SSZ`)
    pub time: String,
}

#[tauri::command]
pub async fn git_repos_log_range(
    root: String,
    since: String,
    until: String,
) -> Result<Vec<RangeCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || collect(&root, &since, &until))
        .await
        .map_err(|e| format!("E_GIT2: 任务调度失败: {e}"))?
        .map_err(String::from)
}

pub fn collect(root: &str, since: &str, until: &str) -> Result<Vec<RangeCommit>, GitError> {
    let since = parse_iso(since)?;
    let until = parse_iso(until)?;
    let scan = super::repos_scan::scan(root, SCAN_DEPTH)?;

    let rows = Mutex::new(Vec::new());
    let rows_ref = &rows;
    std::thread::scope(|s| {
        for summary in &scan.repos {
            s.spawn(move || {
                let Ok(repo) = Repository::open(&summary.path) else {
                    return;
                };
                let Some(rel) = relative(&summary.path, root) else {
                    return;
                };
                for (hash, subject, time) in window_commits(&repo, since, until) {
                    rows_ref.lock().expect("range rows").push(RangeCommit {
                        repo: rel.clone(),
                        hash,
                        subject,
                        time,
                    });
                }
            });
        }
    });
    let mut rows = rows.into_inner().expect("range rows");
    // 按仓分组、仓内提交新→旧(定长 ISO 字典序即时间序)
    rows.sort_by(|a, b| a.repo.cmp(&b.repo).then(b.time.cmp(&a.time)));
    Ok(rows)
}

/// 相对 root 的路径;root 自身(空 rel)记 "."。
fn relative(path: &str, root: &str) -> Option<String> {
    let rel = std::path::Path::new(path).strip_prefix(root).ok()?;
    Some(if rel.as_os_str().is_empty() {
        ".".to_string()
    } else {
        rel.to_string_lossy().into_owned()
    })
}

/// 单仓时间窗提交:(hash, subject, committer ISO)。revwalk / push_head 失败 = 空仓省略。
fn window_commits(repo: &Repository, since: i64, until: i64) -> Vec<(String, String, String)> {
    let revwalk = match repo.revwalk().and_then(|mut w| {
        w.push_head()?;
        w.set_sorting(git2::Sort::TIME)?;
        Ok(w)
    }) {
        Ok(w) => w,
        Err(_) => return vec![],
    };
    revwalk
        .filter_map(|oid| oid.ok())
        .filter_map(|oid| repo.find_commit(oid).ok())
        .filter(|c| {
            let t = c.time().seconds();
            t >= since && t <= until
        })
        .map(|c| {
            (
                c.id().to_string(),
                c.summary().unwrap_or("").to_string(),
                format_iso(c.time().seconds()),
            )
        })
        .collect()
}

/// ISO → epoch 秒。接受 `YYYY-MM-DD[THH:MM[:SS]][.fff][Z]`(T 可为空格);
/// 小数秒与时区后缀忽略,一律按 UTC 取值(窗口两端由前端 `toISOString()` 生成)。
fn parse_iso(s: &str) -> Result<i64, GitError> {
    let bad = || GitError::Shell(format!("E_GIT2: 时间窗解析失败: {s}"));
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' || s[10..].starts_with(['-', '+']) {
        return Err(bad());
    }
    let year: i64 = s[0..4].parse().map_err(|_| bad())?;
    let month: u32 = s[5..7].parse().map_err(|_| bad())?;
    let day: u32 = s[8..10].parse().map_err(|_| bad())?;
    let (hour, min, sec) = if s.len() >= 19 && (b[10] == b'T' || b[10] == b' ') {
        (
            s[11..13].parse::<i64>().map_err(|_| bad())?,
            s[14..16].parse::<i64>().map_err(|_| bad())?,
            s[17..19].parse::<i64>().map_err(|_| bad())?,
        )
    } else {
        (0, 0, 0)
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || min > 59 || sec > 60 {
        return Err(bad());
    }
    Ok(days_from_civil(year, month, day) * 86400 + hour * 3600 + min * 60 + sec)
}

/// epoch 秒 → `YYYY-MM-DDTHH:MM:SSZ`(UTC)。
fn format_iso(secs: i64) -> String {
    let (y, m, d) = civil_from_days(secs.div_euclid(86400));
    let rem = secs.rem_euclid(86400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// 天数 → (y, m, d) 公历算术(Hinnant chrono 免依赖实现)。
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = y - i64::from(m <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (y + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_解析与格式化往返() {
        assert_eq!(
            parse_iso("2026-10-19").unwrap(),
            parse_iso("2026-10-19T00:00:00Z").unwrap()
        );
        let t = parse_iso("2026-10-19T08:30:05Z").unwrap();
        assert_eq!(format_iso(t), "2026-10-19T08:30:05Z");
        // 前端 toISOString() 形态:毫秒小数
        assert_eq!(parse_iso("2026-10-19T08:30:05.123Z").unwrap(), t);
        // 1970 纪元与闰日
        assert_eq!(format_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(
            format_iso(parse_iso("2024-02-29T12:00:00Z").unwrap()),
            "2024-02-29T12:00:00Z"
        );
        assert!(parse_iso("not-a-date").is_err());
        assert!(parse_iso("2026-13-01T00:00:00Z").is_err());
    }

    #[test]
    fn 相对路径_root自身记点() {
        assert_eq!(relative("/a/b", "/a/b").as_deref(), Some("."));
        assert_eq!(relative("/a/b/sub", "/a/b").as_deref(), Some("sub"));
    }

    #[test]
    fn collect_窗口过滤与失败仓省略() {
        use super::super::tests_common::TempRepo;
        let repo = TempRepo::new();
        let when = {
            let r = git2::Repository::open(&repo.dir).unwrap();
            repo.write("a.txt", "v1\n");
            let mut index = r.index().unwrap();
            index.add_path(std::path::Path::new("a.txt")).unwrap();
            index.write().unwrap();
            let tree = r.find_tree(index.write_tree().unwrap()).unwrap();
            let sig = r.signature().unwrap();
            let oid = r
                .commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .unwrap();
            let when = r.find_commit(oid).unwrap().time().seconds();
            when
        };

        // 全窗覆盖:1 条,repo 记 "."
        let wide = collect(repo.path(), "2000-01-01T00:00:00Z", "2099-01-01T00:00:00Z").unwrap();
        assert_eq!(wide.len(), 1);
        assert_eq!(wide[0].repo, ".");
        assert_eq!(wide[0].subject, "init");
        assert_eq!(wide[0].hash.len(), 40);
        assert_eq!(wide[0].time, format_iso(when));

        // 提交前关窗:空
        let empty = collect(repo.path(), "2000-01-01T00:00:00Z", "2000-01-02T00:00:00Z").unwrap();
        assert!(empty.is_empty());

        // 非仓根:扫描成功但无仓,返回空集(单仓失败省略语义)
        let bogus = std::env::temp_dir().join(format!("tmd-range-notrepo-{}", std::process::id()));
        std::fs::create_dir_all(&bogus).unwrap();
        let none = collect(
            bogus.to_str().unwrap(),
            "2000-01-01T00:00:00Z",
            "2099-01-01T00:00:00Z",
        )
        .unwrap();
        assert!(none.is_empty());

        // 坏时间串:整条报错
        assert!(collect(repo.path(), "garbage", "2099-01-01").is_err());
    }
}
