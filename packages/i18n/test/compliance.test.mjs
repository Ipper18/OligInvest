import { expect, test } from "vitest";
import { checkUiText } from "../../../scripts/check-ui-text.mjs";
import { BULK_TEST_TIMEOUT_MS } from "../../../scripts/test-timeouts.mjs";

// Parses every component and dictionary in the repository.
test(
  "production dictionaries, MDX and components contain no forbidden language or JSX text",
  () => {
    expect(checkUiText()).toEqual([]);
  },
  BULK_TEST_TIMEOUT_MS,
);
