"use client";
import { appMessages } from "@oliginvest/i18n";
import { Button } from "@oliginvest/ui";
import { submitAction } from "./actions";
import { clearPrivateState } from "./logout";

// Same order as before BL-413: hide private state, clear cookies, then notify other tabs.
export function SignOutButton() {
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
