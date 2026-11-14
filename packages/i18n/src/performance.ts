import en from "./en/performance.json" with { type: "json" };
import pl from "./pl/performance.json" with { type: "json" };

// Used only by the performance route; excluded from the global localization payload.
export const getPerformanceCopy = (locale: string) => (locale === "en-US" ? en : pl);
