import alertMessages from "./en/alerts.json" with { type: "json" };
import allocationMessages from "./en/allocation.json" with { type: "json" };
import analyticsMessages from "./en/analytics.json" with { type: "json" };
import appMessages from "./en/app.json" with { type: "json" };
import authMailMessages from "./en/auth-mail.json" with { type: "json" };
import bootstrap from "./en/bootstrap.json" with { type: "json" };
import commonMessages from "./en/common.json" with { type: "json" };
import data from "./en/data.json" with { type: "json" };
import disclaimers from "./en/disclaimers.json" with { type: "json" };
import educationMessages from "./en/education.json" with { type: "json" };
import errorMessages from "./en/errors.json" with { type: "json" };
import legalCopy from "./en/legal.json" with { type: "json" };
import marketMessages from "./en/market.json" with { type: "json" };
import onboardingMessages from "./en/onboarding.json" with { type: "json" };
import portfolioMessages from "./en/portfolio.json" with { type: "json" };
import preferencesMessages from "./en/preferences.json" with { type: "json" };
import privacyMessages from "./en/privacy.json" with { type: "json" };
import pwaMessages from "./en/pwa.json" with { type: "json" };
import quickMessages from "./en/quick.json" with { type: "json" };
export const copies = {
  appMessages,
  commonMessages,
  marketMessages,
  pwaMessages,
  privacyMessages,
  portfolioMessages,
  analyticsMessages,
  educationMessages,
  allocationMessages,
  preferencesMessages,
  errorMessages,
  disclaimers,
  legalCopy,
  onboardingMessages,
  alertMessages,
  quickMessages,
  authMailMessages,
  messages: { ...commonMessages, data, bootstrap, app: appMessages },
};
