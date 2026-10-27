import { notFound } from "next/navigation";
import { requireMe } from "../../../../auth/session";
import { InstrumentScreen } from "../../../../portfolio/instrument-screen";
import type { SearchParams } from "../../../../portfolio/page";
import { DomainError, fetchResource, readArgs } from "../../../../portfolio/resources";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ instrumentId: string }>;
  searchParams: SearchParams;
}) {
  const me = await requireMe();
  const { instrumentId } = await params;
  const parsed = readArgs.safeParse({ ...(await searchParams), id: instrumentId });
  if (!parsed.success) notFound();
  const args = { id: instrumentId, interval: parsed.data.interval ?? ("1d" as const) };
  try {
    const [initial, initialChart] = await Promise.all([
      fetchResource("instrument", { id: instrumentId }),
      fetchResource("chart", args),
    ]);
    return (
      <section>
        <InstrumentScreen
          key={`${instrumentId}-${args.interval}`}
          userId={me.id}
          initial={initial}
          initialChart={initialChart}
          args={args}
        />
      </section>
    );
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
