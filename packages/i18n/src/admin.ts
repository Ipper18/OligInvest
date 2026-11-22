import en from "./en/admin.json" with { type: "json" };
import pl from "./pl/admin.json" with { type: "json" };

/**
 * Administrator shell (BL-112, BL-501, BL-509). A separate entry read only by /admin server pages:
 * neither language joins the shell or the copies sent with every page (R-53).
 */
export const adminMessages = pl;
export type AdminMessages = typeof pl;
export function adminCopy(locale: string): AdminMessages {
  return locale === "en-US" ? en : pl;
}
