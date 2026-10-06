//! 账本全局锁 flock 互斥回归(2026-10-06):guard 持有时另一 fd 非阻塞
//! 抢占应被拒,guard 释放后可抢占 —— 锁住「跨实例互斥真的挂上了」
//! (cfg/实现改坏即红;Windows 无 flock,跳过)。

use super::TempWs;

#[cfg(unix)]
#[test]
fn guard_持有时_另一fd_非阻塞抢占被拒_释放后可抢() {
    use std::os::unix::io::AsRawFd;
    let ws = TempWs::new();
    let guard = super::super::lock_ledger();
    let f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(ws.base.join("ledger.lock"))
        .unwrap();
    let busy = unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    assert_ne!(busy, 0, "guard 持有时另一 fd 应抢不到锁");
    drop(guard);
    let taken = unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    assert_eq!(taken, 0, "guard 释放后应可抢占");
}
