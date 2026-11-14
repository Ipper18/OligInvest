import { getPerformanceCopy } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { PerformancePage } from "../../../../portfolio/performance-page";
export async function generateMetadata() {
  return { title: getPerformanceCopy((await getLocalization()).locale).title };
}
export default PerformancePage;
