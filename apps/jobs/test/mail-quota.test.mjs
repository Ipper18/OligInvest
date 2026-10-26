import { expect, test } from "vitest";
import { reserveMail, MailQuotaExceeded } from "../src/mail-quota.js";
test("250 ordinary attempts leave 50 security slots, shared across concurrent callers",async()=>{
  const counts=new Map();
  const counter=async(key)=>{const n=(counts.get(key)??0)+1;counts.set(key,n);return n;};
  const ordinary=await Promise.allSettled(Array.from({length:280},()=>reserveMail(counter,false,0)));
  expect(ordinary.filter(v=>v.status==="fulfilled")).toHaveLength(250);
  const security=await Promise.allSettled(Array.from({length:70},()=>reserveMail(counter,true,0)));
  expect(security.filter(v=>v.status==="fulfilled")).toHaveLength(50);
  await expect(reserveMail(counter,true,0)).rejects.toBeInstanceOf(MailQuotaExceeded);
  await expect(reserveMail(counter,false,86400_000)).resolves.toBeUndefined();
});
test("counter outage fails closed",async()=>{
  await expect(reserveMail(async()=>{throw new Error("down");},true,0)).rejects.toThrow("down");
});
