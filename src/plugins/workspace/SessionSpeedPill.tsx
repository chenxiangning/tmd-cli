/**
 * 会话速度 pill —— 活会话行(运行区/置顶区/组内 LiveSessionRow)共用的 tok/s
 * 指示:turnActive 期间 2s 巡航尾读会话 jsonl,末两条 usage 行差分得响应均速
 * (计算与口径天花板见 cli-shared/sessionUsage 的 recentTokPerSec)。
 *
 * - codex 快照型单行无差分、未绑定磁盘身份、无 listSessions 适配 → 不显示
 *   (缺失不猜测兜底,同会话查看器口径);
 * - 轮结束(isTurnActive=false)pill 消失;单一区域原则保证同一会话同一时刻
 *   至多一处行渲染,无重复巡航;
 * - 文件路径解析一次后盯同一文件(rollout 切换属罕见,读不到即停在旧值下一
 *   拍自愈);末行时间戳超 10 分钟视为陈旧轮残留,不展示。
 */
import { useEffect, useState } from "react";
import type { CliProfile } from "@kernel/cli";
import { host, useHost } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { extractUsageFromHead, recentTokPerSec } from "../cli-shared/sessionUsage";

const POLL_MS = 2000;
const TAIL_BYTES = 64 * 1024;
const STALE_MS = 10 * 60 * 1000;

export function SessionSpeedPill({
  sessionId,
  profile,
  cliSessionId,
  cwd,
}: {
  sessionId: string;
  profile: CliProfile;
  /** 磁盘身份绑定(host.getCliSessionId 实时值,快照字段回写有时差);未绑定 = 不显示。 */
  cliSessionId: string | undefined;
  /** 会话文件定位域(PTY 子目录启动时 session.cwd 优先,工作区 root 兜底)。 */
  cwd: string | undefined;
}) {
  useHost();
  const [speed, setSpeed] = useState<number | null>(null);
  const active =
    cliSessionId !== undefined &&
    cwd !== undefined &&
    profile.listSessions !== undefined &&
    host.isTurnActive(sessionId);
  useEffect(() => {
    if (!active) {
      setSpeed(null);
      return;
    }
    let alive = true;
    let path: string | null = null;
    let lastSize: number | null = null;
    const tick = async () => {
      let next: number | null = null;
      try {
        if (path === null) {
          const list = await profile.listSessions!(cwd!);
          if (!alive) return;
          path = list.find((s) => s.id === cliSessionId)?.path ?? null;
          if (path === null) return; // 文件尚未出生,下一拍重解析
          if (path === "") return; // 该引擎无单文件路径(dsh zstd 在 host 侧):不喂假路径
        }
        const tail = await ipc.fsReadTailChanged(path, TAIL_BYTES, lastSize);
        if (!alive || !tail.changed) return;
        lastSize = tail.size;
        const lines = extractUsageFromHead(tail.text, 0);
        const last = lines[lines.length - 1];
        if (last && Date.now() - last.ts <= STALE_MS) next = recentTokPerSec(lines);
      } catch {
        return; // 单拍 IO 失败静默,下一拍重试
      }
      if (alive) setSpeed(next);
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [active, cliSessionId, cwd, profile]);
  if (!active || speed === null || speed <= 0) return null;
  return (
    <span className="thread-speed-pill" title={t("响应均速(含排队与首字等待,偏保守)")}>
      {Math.round(speed)} tok/s
    </span>
  );
}
