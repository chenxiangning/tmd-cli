/**
 * 工作台 · 绑定 cwd 的最近 CLI 会话扫描 hook。
 * 走 kernel 通道:host.getCliProfiles() × profile.listSessions(cwd)
 * (各 CLI 插件自扫自家存储的既有契约,工作台不做任何格式解析)。
 */

import { useEffect, useState } from "react";
import { host } from "@kernel/host";
import type { CliDiskSession } from "@kernel/cli";

export interface ProjectSessionRow {
  key: string;
  profileId: string;
  profileName: string;
  cliSessionId: string;
  title: string;
  modifiedAt: number;
  disk: CliDiskSession;
}

/** 最近会话(修改时间倒序,上限 12);cwd 空 = 未绑定,null = 扫描中。 */
export function useProjectSessions(cwd: string | undefined): ProjectSessionRow[] | null {
  const [rows, setRows] = useState<ProjectSessionRow[] | null>(null);
  useEffect(() => {
    if (!cwd) {
      setRows(null);
      return;
    }
    let alive = true;
    setRows(null);
    void (async () => {
      const profiles = host.getCliProfiles().filter((p) => p.listSessions);
      const settled = await Promise.all(profiles.map(async (profile) => {
        const list = await profile.listSessions!(cwd).catch(() => [] as CliDiskSession[]);
        return list.map((disk) => ({
          key: `${profile.id}:${disk.id}`,
          profileId: profile.id,
          profileName: profile.name,
          cliSessionId: disk.id,
          title: disk.title || disk.id,
          modifiedAt: disk.modifiedAt,
          disk,
        }));
      }));
      if (!alive) return;
      const merged = settled.flat().sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 12);
      setRows(merged);
    })();
    return () => {
      alive = false;
    };
  }, [cwd]);
  return rows;
}
