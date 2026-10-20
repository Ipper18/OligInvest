"use client";
import { QueryNotice, useResource } from "./query";
import type { ReadArgs, Resource } from "./resources";
import { SummaryView } from "./summary-view";

export type Props<K extends "summary"> = {
  userId: string;
  args: ReadArgs;
  initial: Resource<K>;
  accounts: Resource<"accounts">["data"];
};
export function SummaryScreen({
  userId,
  args,
  initial,
  initialDay,
}: Props<"summary"> & { initialDay: Resource<"day"> }) {
  const query = useResource(userId, "summary", args, initial),
    data = query.data;
  const day = useResource(
    userId,
    "day",
    args.accountId ? { accountId: args.accountId } : {},
    initialDay,
  );
  return (
    <SummaryView
      data={data}
      day={day.data}
      notice={<QueryNotice failed={query.isError} retry={query.refetch} />}
      dayNotice={<QueryNotice failed={day.isError} retry={day.refetch} />}
    />
  );
}
