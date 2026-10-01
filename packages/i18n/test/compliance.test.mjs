import { expect, test } from "vitest";
import { checkUiText } from "../../../scripts/check-ui-text.mjs";

test("production dictionaries, MDX and components contain no forbidden language or JSX text", () => {
  expect(checkUiText()).toEqual([]);
});
