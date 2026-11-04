/**
 * 回顾主视图(批次 C-01 壳,C-02 并入足迹)—— 二级视图:
 * 工作日志(复用 journal 原组件,其视图态仍自持)/ 每日足迹(C-02 迁入,
 * 深链 day 直达/跟跳)/ 会话活动(C-03 并入,嵌入 session-board BoardTab)。
 * 二级视图偏好独立持久化(reviewTabs VIEW_KEY),切主 tab 重挂载后恢复。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { JournalTab } from "../journal/JournalTab";
import { FootprintView } from "./footprint/view/FootprintView";
import { ReviewBoardView } from "./session-board/ReviewBoardView";
import {
  REVIEW_VIEW_ITEMS,
  loadReviewView,
  saveReviewView,
  type ReviewTabPayload,
  type ReviewView,
} from "./reviewTabs";

export function ReviewTab({ review }: { review?: ReviewTabPayload }) {
  const [view, setView] = useState<ReviewView>(loadReviewView);
  /* 持久化走 useEffect(状态更新器内不得有副作用)。 */
  useEffect(() => {
    saveReviewView(view);
  }, [view]);
  /* 深链:合法 view 即切(渲染期比较,WorkbenchTab lastPayload 同款先例)。 */
  const [seen, setSeen] = useState(review);
  if (seen !== review) {
    setSeen(review);
    if (review?.view) setView(review.view);
  }
  return (
    <div className="wb-review" data-icon-decor="review-view">
      <div className="wb-tabs" role="tablist" aria-label={t("回顾视图")}>
        {REVIEW_VIEW_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={`wb-tab${view === item.key ? " is-active" : ""}`}
            onClick={() => setView(item.key)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      {view === "journal" ? (
        <JournalTab />
      ) : view === "footprint" ? (
        /* C-02:每日足迹迁入回顾;深链 day 直达/跟跳由 FootprintView 消费 payload。 */
        <FootprintView payload={review?.day ? { day: review.day } : {}} />
      ) : (
        /* C-03:会话活动嵌入 session-board BoardTab(embedded 形态,不收板钮)。 */
        <ReviewBoardView />
      )}
    </div>
  );
}
