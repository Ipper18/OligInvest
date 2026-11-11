"use client";
import { appMessages as defaultAppMessages } from "@oliginvest/i18n";
import { Button } from "@oliginvest/ui";
import { useCopy } from "@oliginvest/ui/localization";
import { submitAction } from "./actions";
import { clearPrivateState } from "./logout";

// Same order as before BL-413: hide private state, clear cookies, then notify other tabs.
export function SignOutButton() {
  const appMessages = useCopy("appMessages", defaultAppMessages);

  return (
    <Button
      onClick={async () => {
        await clearPrivateState();
        await submitAction("signOut", {});
        await clearPrivateState({ broadcast: true, unsubscribePush: true });
        location.replace("/logowanie");
      }}
    >
      {appMessages.signOut}
    </Button>
  );
}
