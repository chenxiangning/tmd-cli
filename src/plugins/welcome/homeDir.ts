/**
 * 路径显示助手 —— home 前缀缩略(~)与 home 目录异步读取。
 * 自 WelcomePage 按「文件规模铁则」拆出,仅首页显示用。
 */

import { useEffect, useState } from "react";
import { ipc } from "@kernel/ipc";

/** 显示用缩略:home 前缀 → ~(home 目录异步拉一次;拉不到原样显示)。 */
export function useHomeDir(): string | null {
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void ipc
      .configHomeDir()
      .then((h) => alive && setHome(h))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return home;
}

export function shortenHome(p: string, home: string | null): string {
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}
