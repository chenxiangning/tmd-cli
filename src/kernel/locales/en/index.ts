/** en 词典汇总 —— 按域合并;同源串键冲突时后者覆盖(同译无害)。 */
import { MESSAGES as common } from "./common";
import { MESSAGES as settings } from "./settings";
import { MESSAGES as settings2 } from "./settings2";
import { MESSAGES as workspace } from "./workspace";
import { MESSAGES as git } from "./git";
import { MESSAGES as files } from "./files";
import { MESSAGES as cli } from "./cli";
import { MESSAGES as cli2 } from "./cli2";
import { MESSAGES as composer } from "./composer";
import { MESSAGES as ssh } from "./ssh";
import { MESSAGES as misc } from "./misc";
import { MESSAGES as assets } from "./assets";
import { MESSAGES as mobile } from "./mobile";

export const EN_MESSAGES: Record<string, string> = {
  ...common,
  ...settings,
  ...settings2,
  ...workspace,
  ...git,
  ...files,
  ...cli,
  ...cli2,
  ...composer,
  ...ssh,
  ...assets,
  ...misc,
  ...mobile,
};
