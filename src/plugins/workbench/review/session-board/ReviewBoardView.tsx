/** 回顾 → 会话活动嵌入视图(批次 C-03)——复用 session-board 的 BoardTab 本体
 *  (工具栏/热力月历/日泳道零改动),仅包一层高度壳并以 embedded 形态渲染:
 *  工具条不收板钮、键盘链不查覆盖层开关。数据层(boardData/boardRows)仍留在
 *  session-board 原处,本视图只消费组件;C-04 再定数据层去留。 */
import { BoardTab } from "@plugins/session-board/BoardTab";

export function ReviewBoardView() {
  return (
    <div className="wb-review-board">
      <BoardTab embedded />
    </div>
  );
}
