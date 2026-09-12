/** en 词典汇总 —— 按域合并;同源串键冲突时后者覆盖(同译无害)。 */
import { MESSAGES as common } from "./common";
import { MESSAGES as settings } from "./settings";
import { MESSAGES as workspace } from "./workspace";
import { MESSAGES as git } from "./git";
import { MESSAGES as files } from "./files";
import { MESSAGES as cli } from "./cli";
import { MESSAGES as composer } from "./composer";
import { MESSAGES as ssh } from "./ssh";
import { MESSAGES as misc } from "./misc";
import { MESSAGES as assets } from "./assets";

export const EN_MESSAGES: Record<string, string> = {
  ...common,
  ...settings,
  ...workspace,
  ...git,
  ...files,
  ...cli,
  ...composer,
  ...ssh,
  ...assets,
  ...misc,
};
