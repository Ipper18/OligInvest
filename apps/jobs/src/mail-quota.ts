export class MailQuotaExceeded extends Error {
  constructor(readonly retryAt:number) { super("MAIL_QUOTA_EXCEEDED"); }
}
/** Count attempts before SMTP. No refund on ambiguous SMTP failures. */
export async function reserveMail(increment:(key:string)=>Promise<number>,security:boolean,now=Date.now()) {
  const day=Math.floor(now/86400_000),retryAt=(day+1)*86400_000;
  if(!security && await increment(`quota:mail:ordinary:${day}`)>250) throw new MailQuotaExceeded(retryAt);
  if(await increment(`quota:mail:total:${day}`)>300) throw new MailQuotaExceeded(retryAt);
}
