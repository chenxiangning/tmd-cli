/**
 * 已挂图片状态(会话屏 composer 预览挂载):选图(native PHPicker)→ 压缩 →
 * 桥落盘临时文件 → 缩略图上屏(remote.attachShot);移除/发送/卸载统一释放
 * objectURL。发送拼装走 composeSendText,这里只管挂载生命周期。
 */
import React, { useEffect, useState } from "react";
import { attachShot } from "./remote";

export interface Shot {
  path: string;
  url: string;
}

export function useShots(): {
  shots: Shot[];
  onShot: () => void;
  removeShot: (path: string) => void;
  clearShots: () => void;
  busy: boolean;
  err: boolean;
} {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  /* 卸载清理要拿最新表;镜像在 effect 落(ref 渲染期变更会挨 react-doctor) */
  const ref = React.useRef(shots);
  React.useEffect(() => {
    ref.current = shots;
  });

  const onShot = (): void => {
    void attachShot({
      isBusy: busy,
      setBusy,
      onShot: (s) => setShots((a) => [...a, s]),
      flashErr: setErr,
    });
  };
  const removeShot = (path: string): void => {
    const s = ref.current.find((x) => x.path === path);
    if (s) URL.revokeObjectURL(s.url);
    setShots((a) => a.filter((x) => x.path !== path));
  };
  const clearShots = (): void => {
    for (const s of ref.current) URL.revokeObjectURL(s.url);
    setShots([]);
  };
  useEffect(
    () => () => {
      for (const s of ref.current) URL.revokeObjectURL(s.url);
    },
    [],
  );
  return { shots, onShot, removeShot, clearShots, busy, err };
}
