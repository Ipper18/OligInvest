import {toDecimal} from '@oliginvest/core';
import type {DatabaseContext,DatabaseTransaction} from '@oliginvest/db';
import {formatMessage,formatMoney,formatPrice,formatQuantity,quickMessages} from '@oliginvest/i18n';
import {summarySchema} from '@oliginvest/mod-market/contracts';
import {MarketRepository} from '@oliginvest/mod-market/server';
import {readPortfolio,type PortfolioRepository} from '@oliginvest/mod-portfolio/server';
import {ProblemError} from '@oliginvest/platform';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {freshness,incompleteReason,normalizeQuickDecimal,quickCreated,quickPortfolio,quickQuote,quickToday,quickTransactionInput} from '../contracts.js';

type Snapshot=Extract<Awaited<ReturnType<typeof readPortfolio>>,{summary:unknown}>;
export function projectQuickSnapshot(snapshot:Snapshot,kind:'portfolio'|'today'){
 const {summary,day}=snapshot;
 const reasons:z.infer<typeof incompleteReason>[]=[...snapshot.gaps,...snapshot.previousGaps].map(g=>g.kind==='fx'?{code:'missing_fx_rate',pair:`${g.base}/${g.quote}`}:{code:'missing_price',instrumentId:g.instrumentId});
 if(kind==='portfolio'){
  for(const instrumentId of snapshot.missingCosts)reasons.push({code:'missing_cost_basis',instrumentId});
 }
 if(!day.change&&!reasons.length)reasons.push({code:'missing_day_baseline'});
 const unique=[...new Map(reasons.map(r=>[JSON.stringify(r),r])).values()];
 const metadata=freshness.parse({asOf:summary.meta.asOf,stale:summary.meta.stale,source:summary.meta.source,delayMinutes:summary.meta.delayMinutes});
 const base={...metadata,incomplete:unique.length>0,reasons:unique,dayChange:day.change,dayChangeRatio:day.changeRatio};
 if(kind==='today')return quickToday.parse(base);
 const topPositions=snapshot.positions.filter(p=>p.weight!==null).toSorted((a,b)=>b.weight!-a.weight!).slice(0,5).map(p=>({ticker:p.instrument.ticker,weight:p.weight!}));
 return quickPortfolio.parse({...base,totalValue:summary.isComplete?summary.totalValue:null,unrealizedPl:summary.isComplete&&summary.exclusions.count===0?summary.unrealizedPl:null,topPositions});
}
const currency=(value:string)=>z.enum(['PLN','USD','EUR']).parse(value);
export function quickText(kind:'portfolio'|'today'|'quote',input:unknown):string{
 const value=kind==='quote'?quickQuote.parse(input):kind==='portfolio'?quickPortfolio.parse(input):quickToday.parse(input);
 if('incomplete' in value&&value.incomplete){
  const reasons=[...new Set(value.reasons.map(r=>r.code==='missing_fx_rate'?formatMessage(quickMessages.missing_fx_rate,{pair:r.pair??''}):quickMessages[r.code]))];
  return formatMessage(quickMessages.incomplete,{reasons:reasons.join('; ')});
 }
 const money=(m:{amount:string;currency:string}|null)=>m?formatMoney(m.amount,currency(m.currency)):quickMessages.missing_day_baseline;
 const line='price' in value?formatMessage(quickMessages.quote,{ticker:value.ticker,price:formatPrice(value.price,currency(value.currency),2)}):'totalValue' in value?formatMessage(quickMessages.portfolio,{value:money(value.totalValue),change:money(value.dayChange)}):formatMessage(quickMessages.today,{change:money(value.dayChange)});
 return `${line}\n${formatMessage(quickMessages.freshness,{time:new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',dateStyle:'short',timeStyle:'short'}).format(new Date(value.asOf)),delay:String(value.delayMinutes),source:value.source,stale:value.stale?quickMessages.stale:''})}`;
}
export class QuickRepository{
 constructor(readonly portfolio:PortfolioRepository){}
 async snapshot(context:DatabaseContext,kind:'portfolio'|'today'){
  const value=await readPortfolio(this.portfolio,context,'getQuickSnapshot',{view:'economic',groupBy:'instrument'});
  if(!('summary' in value)||!value.summary)throw Error('INVALID_QUICK_SNAPSHOT');
  return projectQuickSnapshot(value as Snapshot,kind);
 }
 async resolve(tx:DatabaseTransaction,ticker:string,mic?:string){
  const rows=(await tx.execute(sql`SELECT id::text,ticker,name,mic,currency,type,is_active AS "isActive" FROM market.instruments WHERE upper(ticker)=upper(${ticker}) AND is_active AND (${mic??null}::text IS NULL OR mic=${mic??null}) ORDER BY mic,id`)).rows.map(r=>summarySchema.parse(r));
  if(!rows.length)throw new ProblemError('NOT_FOUND');
  if(rows.length>1)throw new ProblemError('INSTRUMENT_AMBIGUOUS',{candidates:rows});
  return rows[0]!;
 }
 async quote(context:DatabaseContext,ticker:string,mic?:string){
  const instrument=await this.portfolio.read(context,tx=>this.resolve(tx,ticker,mic));
  const quote=(await new MarketRepository(this.portfolio.database,this.portfolio.now).quotes(context,[instrument.id]))[0];
  if(!quote)throw new ProblemError('NOT_FOUND');
  return quickQuote.parse({ticker:instrument.ticker,name:instrument.name,mic:instrument.mic,price:quote.price,currency:quote.currency,changeRatio:quote.changeRatio??null,...freshness.parse({asOf:quote.meta.asOf,source:quote.meta.source,stale:quote.meta.stale,delayMinutes:quote.meta.delayMinutes})});
 }
 async create(context:DatabaseContext,tokenId:string,raw:unknown,key:string){
  const input=quickTransactionInput.parse(raw);
  const result=await this.portfolio.mutate(context,tx=>this.portfolio.replay(tx,context,key,'/quick/transactions',input,201,async()=>{
   const instrument=await this.resolve(tx,input.ticker,input.mic);
   const accounts=(await tx.execute(sql`SELECT id::text,name,currency FROM portfolio.accounts WHERE closed_on IS NULL AND account_type<>'demo' ORDER BY name,id`)).rows;
   const matches=accounts.filter(a=>(!input.accountId||a.id===input.accountId)&&(!input.accountName||String(a.name).toLocaleLowerCase('pl-PL')===input.accountName.toLocaleLowerCase('pl-PL')));
   if(matches.length!==1)throw new ProblemError('VALIDATION_FAILED',{detail:formatMessage(quickMessages.accounts,{names:accounts.map(a=>String(a.name)).join(', ')})});
   const account=matches[0]!,price=normalizeQuickDecimal(input.price),quantity=normalizeQuickDecimal(input.quantity),fee=normalizeQuickDecimal(input.fee??'0');
   if(!toDecimal(price).gt(0)||!toDecimal(quantity).gt(0))throw new ProblemError('VALIDATION_FAILED');
   if(input.currency&&input.currency!==instrument.currency)throw new ProblemError('VALIDATION_FAILED');
   // A quick request has no FX-rate field: do not invent a conversion for a foreign-currency account.
   if(account.currency!==instrument.currency)throw new ProblemError('VALIDATION_FAILED',{detail:'Waluta rachunku musi odpowiadać walucie transakcji; przeliczenie wymaga pełnego formularza.'});
   const tradeDate=input.tradeDate??new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw'}).format(this.portfolio.now());
   if(!input.confirmDuplicate&&(await tx.execute(sql`SELECT id FROM portfolio.transactions WHERE account_id=${account.id}::uuid AND instrument_id=${instrument.id}::uuid AND type=${input.side} AND quantity=${quantity}::numeric AND price=${price}::numeric AND trade_date=${tradeDate}::date AND created_at>=now()-interval '10 minutes' LIMIT 1`)).rows.length)throw new ProblemError('CONFLICT',{detail:quickMessages.duplicate});
   const record=await this.portfolio.insertTransaction(tx,context,{accountId:account.id,instrumentId:instrument.id,type:input.side,quantity,price,priceCurrency:instrument.currency,tradeDate,fee:{amount:fee,currency:instrument.currency},...(input.note?{note:input.note}:{})},tokenId);
   const summary=formatMessage(quickMessages.created,{side:input.side,quantity:formatQuantity(quantity),ticker:instrument.ticker,price:formatPrice(price,currency(instrument.currency),2),account:String(account.name)});
   return {response:quickCreated.parse({transactionId:record.id,accountId:account.id,instrument,summary}),tradeDate};
  }),key);
  await this.portfolio.enqueue({userId:context.userId!,accountIds:[result.value.response.accountId],fromDate:result.value.tradeDate,reason:'transactions'});
  return {data:result.value.response,replayed:result.replayed};
 }
}
