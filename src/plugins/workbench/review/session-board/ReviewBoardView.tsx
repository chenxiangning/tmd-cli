/** 回顾 → 会话活动嵌入视图(批次 C-03 迁入,C-04 随 overlay 退役定型为唯一形态):
 *  BoardTab 本体(工具栏/热力月历/日泳道)在 ./BoardTab,本组件只包一层高度壳
 *  (.wb-review-board 吃满回顾剩余高度,sb-root 高度 100% 撑满)。 */
import { BoardTab } from "./BoardTab";

export function ReviewBoardView() {
  return (
    <div className="wb-review-board">
      <BoardTab />
    </div>
  );
}
