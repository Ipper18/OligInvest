import { BlockList, isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { AppEnv } from "@oliginvest/platform";
import type { Context } from "hono";

export function clientIpResolver(cidrs: readonly string[]) {
  const trusted = new BlockList();
  for (const cidr of cidrs) {
    const [address, bits, extra] = cidr.split("/");
    const family = isIP(address ?? "");
    if (!address || !family || extra || !/^\d+$/u.test(bits ?? ""))
      throw new Error("Invalid trusted proxy CIDR");
    trusted.addSubnet(address, Number(bits), family === 4 ? "ipv4" : "ipv6");
  }
  return (peer: string, forwarded: string | undefined): string => {
    const address = peer.startsWith("::ffff:") && isIP(peer.slice(7)) === 4 ? peer.slice(7) : peer;
    const family = isIP(address);
    if (!family) return "unknown";
    if (trusted.check(address, family === 4 ? "ipv4" : "ipv6") && forwarded && isIP(forwarded))
      return forwarded;
    return address;
  };
}

export function requestClientIp(cidrs: readonly string[]) {
  const resolve = clientIpResolver(cidrs);
  return (context: Context<AppEnv>) =>
    resolve(getConnInfo(context).remote.address ?? "", context.req.header("x-forwarded-for"));
}
