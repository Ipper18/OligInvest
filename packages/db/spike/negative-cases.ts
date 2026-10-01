import { selectById } from "./typescript-7.js";

export function verifyQueryInput(): void {
  // @ts-expect-error BL-032: UUID query input must remain a string.
  selectById(42);
}
