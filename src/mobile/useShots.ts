/**
 * 已挂图片状态(会话屏 composer 预览挂载):选图(native PHPicker)/拍照
 * (takePhoto 桥)→ 原图即时 pending 预览 → 压缩 → 桥落盘临时文件 → 缩略图
 * 上屏(remote.attachShot);移除/发送/卸载统一释放 objectURL(在途到货于
 * 卸载后 = 即时 revoke,防孤儿 blob URL);发送拼装走 composeSendText,
 * 这里只管挂载生命周期。错误条 3s 自清定时器归本 hook 单点管理(新错误
 * 到达先清旧定时器,免交叠提前清错 —— UI 策略不进 remote 层)。
 */
import { useEffect, useRef, useState } from "react";
import { attachShot, type ShotErr, type ShotSource } from "./remote";

export interface Shot {
  path: string;
  url: string;
}

export interface ShotError {
  /** 分档:null 无错;album/camera 对应选图/拍照失败文案。 */
  kind: ShotErr;
  /** 原生桥给的失败明细(如「相机权限被拒,请在系统设置开启」);缺省走分档文案。 */
  detail?: string;
}

export function useShots(): {
  shots: Shot[];
  /** 上传中原图预览(objectURL;null = 无上传在途)。 */
  pending: string | null;
  /** 相册选图入口(PHPicker)。 */
  onShot: () => void;
  /** 拍照入口(相机拍摄上传)。 */
  onPhoto: () => void;
  removeShot: (path: string) => void;
  /** 清除挂图:默认全清;传 paths 只清发送起点快照内的(发送在途新挂的图
   *  不随消息清掉 —— 它不在本次发送里,清了 = 静默丢用户输入,2026-10-03 评审)。 */
  clearShots: (paths?: string[]) => void;
  busy: boolean;
  /** 错误条:err = null 无错;kind 分档文案,detail 有值时优先展示。 */
  err: ShotError | null;
} {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ShotError | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  /* 卸载清理要拿最新表;镜像在 effect 落(ref 渲染期变更会挨 react-doctor) */
  const ref = useRef(shots);
  useEffect(() => {
    ref.current = shots;
  });
  /* 卸载标记:在途上传到货时 setShots 已是 no-op,终态 objectURL 须当场释放。
   * body 复位 true:两入口都包 StrictMode,dev 双挂载会先跑一遍 cleanup 把
   * alive 钉死 false,不复位则之后每次 onShot 都走「卸载后到货」白 revoke。 */
  const alive = useRef(true);
  const errTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(errTimer.current);
      for (const s of ref.current) URL.revokeObjectURL(s.url);
    };
  }, []);
  /* flashErr = 单次错误上报(detail = 原生桥明细,如相机权限指引);3s 自清是
   * UI 策略,新错误先清旧定时器免交叠 */
  const flashErr = (kind: ShotErr, detail?: string): void => {
    setErr(kind === null ? null : { kind, detail });
    if (kind === null) return;
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setErr(null), 3000);
  };

  const attach = (source: ShotSource): void => {
    void attachShot(
      {
        isBusy: busy,
        setBusy,
        onShot: (s) => {
          if (!alive.current) {
            URL.revokeObjectURL(s.url); /* 卸载后到货:不留孤儿 blob URL */
            return;
          }
          setShots((a) => [...a, s]);
        },
        flashErr,
        onPending: setPending,
        onPendingDone: () => setPending(null),
      },
      { source },
    );
  };
  const onShot = (): void => attach("album");
  const onPhoto = (): void => attach("camera");
  const removeShot = (path: string): void => {
    const s = ref.current.find((x) => x.path === path);
    if (s) URL.revokeObjectURL(s.url);
    setShots((a) => a.filter((x) => x.path !== path));
  };
  const clearShots = (paths?: string[]): void => {
    const doomed = paths ? new Set(paths) : null;
    for (const s of ref.current) {
      if (!doomed || doomed.has(s.path)) URL.revokeObjectURL(s.url);
    }
    setShots((a) => (doomed ? a.filter((x) => !doomed.has(x.path)) : []));
  };
  return { shots, pending, onShot, onPhoto, removeShot, clearShots, busy, err };
}
