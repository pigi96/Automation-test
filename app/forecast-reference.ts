import type { Coin, Point } from './market-utils';
export const REFERENCE_GRACE_MS=10*60*1000;
export const CONTEXT_GLOBAL_MAX_AGE_MS=15*60*1000;
export const CONTEXT_FEAR_MAX_AGE_MS=48*60*60*1000;
const FUTURE_GRACE_MS=5*60*1000,DAY=86400000;
const validTime=(value:number)=>Number.isFinite(value)&&Number.isFinite(new Date(value).getTime());
const positive=(value:number)=>Number.isFinite(value)&&value>0;
export type PriceSnapshot={assetId:string;price:number;time:number;receivedAt:number;timeSource:'provider'|'received'};
export type HistoryReference={assetId:string;points:Pick<Point,'time'|'price'>[]};
export type ForecastReference={price:number;time:number;cached:boolean;source:'market'|'history';timeSource:'provider'|'received'|'recorded'};
/** Capture a price and its timestamp together when a new market snapshot arrives.
 * Providers without a valid observation timestamp use a clearly labelled receipt time. */
export function capturePriceSnapshot(coin:Coin|undefined,receivedAt:number):PriceSnapshot|null {
 if(!coin||!positive(coin.current_price)||!validTime(receivedAt))return null;
 const providerTime=typeof coin.last_updated==='string'?Date.parse(coin.last_updated):NaN;
 const useProvider=validTime(providerTime)&&providerTime<=receivedAt;
 return {assetId:coin.id,price:coin.current_price,time:useProvider?providerTime:receivedAt,receivedAt,timeSource:useProvider?'provider':'received'};
}
/** Never combine one asset's history with another asset's market snapshot. */
export function resolveForecastReference(assetId:string|undefined,snapshot:PriceSnapshot|null,history:HistoryReference|null,marketFresh:boolean,now:number):ForecastReference|null {
 if(!assetId||!validTime(now))return null;
 if(snapshot?.assetId===assetId&&marketFresh&&positive(snapshot.price)&&validTime(snapshot.time)&&snapshot.time<=now&&now-snapshot.time<=REFERENCE_GRACE_MS){return {price:snapshot.price,time:snapshot.time,cached:false,source:'market',timeSource:snapshot.timeSource}}
 if(history?.assetId!==assetId)return null;
 let latest:Pick<Point,'time'|'price'>|undefined;
 for(const point of history.points)if(validTime(point.time)&&point.time<=now&&positive(point.price)&&(!latest||point.time>latest.time))latest=point;
 return latest?{price:latest.price,time:latest.time,cached:true,source:'history',timeSource:'recorded'}:null;
}
export function expiredReferenceHorizon(reference:ForecastReference,days:number,now:number):boolean{return reference.cached&&reference.time+days*DAY<=now}
/** Keep existing context weights. A daily Fear & Greed reading has a different
 * expiry from the global market snapshot; failed/cached refreshes admit neither. */
export function resolveForecastContext(context:any,now:number){
 const unavailable={available:false,score:0,globalAvailable:false,fearAvailable:false};
 if(!context||context.stale||context.failed||!validTime(now))return unavailable;
 const received=Date.parse(context.updatedAt);
 const fresh=(time:number,maxAge:number)=>validTime(time)&&time<=now+FUTURE_GRACE_MS&&now-time<=maxAge;
 if(!fresh(received,REFERENCE_GRACE_MS))return unavailable;
 const globalTime=Number.isFinite(context.global?.timestamp)?context.global.timestamp*1000:received;
 const fearTime=Number.isFinite(context.fear?.time)?context.fear.time:received;
 const globalAvailable=Number.isFinite(context.global?.change)&&fresh(globalTime,CONTEXT_GLOBAL_MAX_AGE_MS);
 const fearAvailable=Number.isFinite(context.fear?.value)&&context.fear.value>=0&&context.fear.value<=100&&fresh(fearTime,CONTEXT_FEAR_MAX_AGE_MS);
 const score=(globalAvailable?context.global.change/8*.8:0)+(fearAvailable?(context.fear.value-50)/50*.2:0);
 return {available:globalAvailable||fearAvailable,score:Math.max(-1,Math.min(1,score)),globalAvailable,fearAvailable};
}
