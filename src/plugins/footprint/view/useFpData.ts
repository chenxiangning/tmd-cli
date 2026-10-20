/**
 * footprint 视图数据装配:当月热力 / 当日明细 / 区间明细的加载时机。
 * live 信号 rev(ckptTurnSealed)命中即轻刷新;自 FootprintView 拆出守 300 行铁则。
 */
import { useEffect, useState } from "react";
import { dayKeyOf, loadDayDetail, loadMonthHeat, loadRangeDetails } from "../dataSource";
import type { FpDayDetail, HeatCell } from "../dataSource";

export interface FpDataParams {
  ymStr: string;
  sel: string;
  /** 区间 [起, 止];null = 单日模式。 */
  range: [string, string] | null;
  /** ckptTurnSealed 序号(到达即重拉)。 */
  rev: number;
}

export interface FpData {
  month: HeatCell[];
  detail: FpDayDetail | null;
  rangeDetails: FpDayDetail[];
  /** 当日明细在途(点日/封口重拉期间,UI 显示 loading 而非旧日数据)。 */
  dayLoading: boolean;
  /** 搜索跳转等场景直接替换当日明细。 */
  setDetail: (d: FpDayDetail | null) => void;
}

export function useFpData({ ymStr, sel, range, rev }: FpDataParams): FpData {
  const [month, setMonth] = useState<HeatCell[]>([]);
  const [detail, setDetail] = useState<FpDayDetail | null>(null);
  const [rangeDetails, setRangeDetails] = useState<FpDayDetail[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  /* 切月 / live 封口:重读当月热力(rollup 月缓存由数据层自管理) */
  useEffect(() => {
    void loadMonthHeat(ymStr).then(setMonth);
  }, [ymStr, rev]);

  /* 点日 / 封口当日:当日明细重拉 */
  useEffect(() => {
    let alive = true;
    setDayLoading(true);
    void loadDayDetail(sel)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch(() => undefined) /* 扫描失败落空态而非永卡 spinner */
      .finally(() => {
        if (alive) setDayLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sel, rev]);

  /* 区间明细(会话清单单次扫描) */
  useEffect(() => {
    if (!range) {
      setRangeDetails([]);
      return;
    }
    let alive = true;
    const days: string[] = [];
    const cur = new Date(`${range[0]}T12:00:00`);
    while (dayKeyOf(cur) <= range[1] && days.length < 62) {
      days.push(dayKeyOf(cur));
      cur.setDate(cur.getDate() + 1);
    }
    void loadRangeDetails(days).then((ds) => {
      if (alive) setRangeDetails(ds);
    });
    return () => {
      alive = false;
    };
  }, [range]);

  return { month, detail, rangeDetails, dayLoading, setDetail };
}
