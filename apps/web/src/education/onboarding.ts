import { onboardingMessages as m } from "@oliginvest/i18n/onboarding";
import { onboardingAction } from "./onboarding-action";

let starting = false;
export async function startOnboarding(
  restart = false,
  alive = () => true,
  focusTarget?: HTMLElement,
) {
  if (starting) return () => {};
  starting = true;
  try {
    const state = await onboardingAction(restart ? { action: "restart" } : undefined);
    if (!alive() || (!restart && (state.completedAt || state.skippedAt))) {
      starting = false;
      return () => {};
    }
    const [{ driver }] = await Promise.all([
      import("driver.js"),
      import("driver.js/dist/driver.css"),
    ]);
    if (!alive()) {
      starting = false;
      return () => {};
    }
    const selectors: Record<string, string> = {
      welcome: "header",
      account: 'a[href="/portfel/rachunki"]',
      import: 'a[href="/portfel/import"]',
      demo: 'a[href="/nauka/demo"]',
      value: '[data-onboarding="totalValue"]',
      day: '[data-onboarding="dayChange"]',
      explainer: ".oi-popover-root button",
      footer: "footer",
    };
    const steps = m.steps.filter(
      (step) => step.key !== "demo" || document.querySelector(selectors.demo ?? ""),
    );
    const originalFocus = focusTarget ?? document.activeElement;
    let queue = Promise.resolve();
    const report = () => {
      if (!alive() || document.getElementById("onboarding-error")) return;
      const notice = document.createElement("div");
      notice.id = "onboarding-error";
      notice.setAttribute("role", "alert");
      notice.className = "oi-error-summary";
      const text = document.createElement("p");
      text.textContent = m.error;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "oi-button";
      close.textContent = m.dismiss;
      close.onclick = () => notice.remove();
      notice.append(text, close);
      document.querySelector("main")?.prepend(notice);
    };
    const persist = (action: "advance" | "skip" | "complete", step?: string) => {
      queue = queue
        .then(async () => {
          await onboardingAction({ action, ...(step ? { step } : {}) });
        })
        .catch(report);
    };
    const tour = driver({
      animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      allowKeyboardControl: true,
      allowClose: true,
      disableActiveInteraction: true,
      showButtons: ["previous", "next"],
      showProgress: true,
      nextBtnText: m.next,
      prevBtnText: m.previous,
      doneBtnText: m.done,
      steps: steps.map((step) => ({
        ...(document.querySelector(selectors[step.key] ?? "main")
          ? { element: selectors[step.key] }
          : {}),
        popover: { title: step.title, description: step.text },
      })),
      onHighlighted: (_element, _step, { index }) => {
        persist("advance", steps[index ?? 0]?.key);
      },
      onPopoverRender: (popover) => {
        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "oi-button";
        skip.textContent = m.skip;
        skip.onclick = () => {
          persist("skip");
          tour.destroy();
        };
        popover.footerButtons.prepend(skip);
      },
      onDestroyStarted: () => {
        persist("skip");
        tour.destroy();
      },
      onNextClick: () => {
        if (tour.isLastStep()) {
          persist("complete");
          tour.destroy();
        } else tour.moveNext();
      },
      onDestroyed: () => {
        starting = false;
        queueMicrotask(() => {
          if (originalFocus instanceof HTMLElement && originalFocus.isConnected)
            originalFocus.focus();
        });
      },
    });
    tour.drive(
      Math.max(
        0,
        steps.findIndex((step) => step.key === state.step),
      ),
    );
    return () => {
      tour.destroy();
      starting = false;
    };
  } catch (error) {
    starting = false;
    throw error;
  }
}
