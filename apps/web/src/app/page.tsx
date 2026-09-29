import { messages } from "@oliginvest/i18n";
import { getHealthStatus } from "../api/server";

export default async function TestPage() {
  const status = await getHealthStatus();
  return (
    <main>
      <h1>{messages.bootstrap.title}</h1>
      <p>{messages.bootstrap.description}</p>
      <p>{messages.bootstrap.apiStatus[status]}</p>
    </main>
  );
}
