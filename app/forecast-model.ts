import {selectForecastEvidence,summarizeForecastSentiment} from './forecast-signals';
import type { Point } from './market-utils';
export const DAY = 86400000;
export const HORIZONS = [{days:1,label:'1 day',min:8},{days:7,label:'7 days',min:15},{days:30,label:'30 days',min:31},{days:90,label:'90 days',min:61},{days:365,label:'1 year',min:181}] as const;
export type SignalItem = {title:string;text?:string;url:string;source:string;date:string;kind?:string};
export type Daily = {time:number;price:number};
const bound=(n:number,low:number,high:number)=>Math.max(low,Math.min(high,n));
export function dailyPrices(points:Point[]):Daily[]{
  const days=new Map<number,Daily>();
  for(const p of [...points].sort((a,b)=>a.time-b.time))if(Number.isFinite(p.time)&&Number.isFinite(p.price)&&p.price>0)days.set(Math.floor(p.time/DAY),{time:p.time,price:p.price});
  return [...days.values()];
}
export {scoreText as textScore} from './forecast-signals';
export function relevantItems(items:SignalItem[],name:string,symbol:string,now=Date.now()){return selectForecastEvidence(items,name,symbol,now)}
export function sentiment(items:SignalItem[],now=Date.now()){return summarizeForecastSentiment(items,now)}
export function fitPriceModel(daily:Daily[]){
  const tail=daily.slice(-181);if(tail.length<8)throw new Error('At least 8 daily price observations are needed.');
  const returns=tail.slice(1).map((p,i)=>Math.log(p.price/tail[i].price)/Math.sqrt(Math.max(1,(p.time-tail[i].time)/DAY)));
  const mean=returns.reduce((s,r)=>s+r,0)/returns.length;
  const sigma=Math.sqrt(returns.reduce((s,r)=>s+(r-mean)**2,0)/Math.max(1,returns.length-1));
  if(!Number.isFinite(sigma))throw new Error('Price volatility cannot be estimated from this history.');
  const trend=(n:number)=>{const end=tail.at(-1)!,start=tail[Math.max(0,tail.length-1-n)];return Math.log(end.price/start.price)/Math.max(1,(end.time-start.time)/DAY)};
  return {sigma,drift:bound(.35*(.65*trend(7)+.35*trend(30)),-.006,.006),days:tail.length};
}
export function forecast(daily:Daily[],anchor:number,days:number,signals:{news?:number;social?:number;market?:number}={},now=Date.now()){
  const horizon=HORIZONS.find(h=>h.days===days);if(!horizon)throw new Error('Unsupported forecast horizon.');
  if(daily.length<horizon.min)throw new Error(`This horizon needs ${horizon.min} daily observations; ${daily.length} are available.`);
  if(!(anchor>0)||!Number.isFinite(anchor))throw new Error('A positive reference price is required.');
  const fit=fitPriceModel(daily);
  // Damped log-price momentum, plus small explicitly heuristic short-lived inputs.
  const news=bound(signals.news||0,-1,1),social=bound(signals.social||0,-1,1),market=bound(signals.market||0,-1,1);
  const logAt=(t:number)=>fit.drift*30*(1-Math.exp(-t/30))+(.015*news+.005*social+.005*market)*(1-Math.exp(-t/3))*Math.exp(-t/30);
  const steps=days===1?24:days;
  const points=Array.from({length:steps+1},(_,i)=>{const t=days*i/steps;const middle=anchor*Math.exp(logAt(t));const width=1.2815515655*fit.sigma*Math.sqrt(t*(1+t/Math.max(1,fit.days-1)));return {time:now+t*DAY,middle,lower:middle*Math.exp(-width),upper:middle*Math.exp(width)}});
  if(points.some(p=>!Number.isFinite(p.lower)||!Number.isFinite(p.middle)||!Number.isFinite(p.upper)||p.lower<=0))throw new Error('Model uncertainty is too large for a meaningful numeric range.');
  const end=points.at(-1)!;
  return {...end,points,change:(end.middle/anchor-1)*100,sigma:fit.sigma,drift:fit.drift,observations:daily.length,drivers:{momentum:fit.drift*30*(1-Math.exp(-days/30)),language:(.015*news+.005*social)*(1-Math.exp(-days/3))*Math.exp(-days/30),context:.005*market*(1-Math.exp(-days/3))*Math.exp(-days/30)}};
}
export function historicalCheck(daily:Daily[],days:number){
  const min=HORIZONS.find(h=>h.days===days)?.min||8;const rows:{model:number;baseline:number}[]=[];
  for(let end=daily.length-1;end-days>=min-1 && rows.length<12;end-=Math.max(1,days)){
    const origin=end-days,training=daily.slice(0,origin+1),actual=daily[end].price;
    const elapsed=(daily[end].time-daily[origin].time)/DAY;
    if(Math.abs(elapsed-days)>1.5)continue;
    let f;try{f=forecast(training,daily[origin].price,days,{},daily[origin].time)}catch{continue}
    rows.push({model:Math.abs(f.middle-actual)/actual*100,baseline:Math.abs(daily[origin].price-actual)/actual*100});
  }
  return {count:rows.length,mape:rows.length?rows.reduce((s,r)=>s+r.model,0)/rows.length:null,baseline:rows.length?rows.reduce((s,r)=>s+r.baseline,0)/rows.length:null};
}
