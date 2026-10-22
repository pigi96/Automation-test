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
const positive=new Set('approval approved adoption adopt breakthrough bullish gain gains growth grow inflow inflows launch launches partnership rally rallies rebound rebounds recovery recover rises surge surges upgrade win wins'.split(' '));
const negative=new Set('ban banned bearish breach collapse crash crashes decline declines down downgrade exploit exploited falls falling fraud hack hacked hacks lawsuit liquidation liquidations loss losses outflow outflows plunge plunges scam selloff slump slumps theft'.split(' '));
export function textScore(text:string):number{
  const tokens=text.toLowerCase().replace(/https?:\/\/\S+/g,' ').match(/[a-z]+/g)||[];let value=0,hits=0;
  tokens.forEach((word,i)=>{let score=positive.has(word)?1:negative.has(word)?-1:0;if(score){if(tokens.slice(Math.max(0,i-3),i).some(w=>['not','no','never','without'].includes(w)))score=-score;value+=score;hits++}});
  return hits?bound(value/Math.sqrt(hits),-1,1):0;
}
export function relevantItems(items:SignalItem[],name:string,symbol:string,now=Date.now()):SignalItem[]{
  const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const common=new Set(['just','sky','near','link','gate','render','rain','quant','pearl','flow']);
  const full=new RegExp('(^|[^a-z0-9])'+escape(name)+'(?=$|[^a-z0-9])',common.has(name.toLowerCase())?'':'i');
  const cash=new RegExp('\\$'+escape(symbol)+'\\b','i');
  const seen=new Set<string>();
  return items.filter(item=>{const time=Date.parse(item.date),text=item.title+' '+(item.text||'');const key=item.title.toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^a-z0-9]/g,'');if(!Number.isFinite(time)||time>now+900000||now-time>7*DAY||(!full.test(text)&&!cash.test(text))||seen.has(key))return false;seen.add(key);return true;});
}
export function sentiment(items:SignalItem[],now=Date.now()){
  let total=0,weights=0,scored=0;
  for(const item of items){const score=textScore(item.title+' '+(item.text||''));const age=Math.max(0,now-Date.parse(item.date));const weight=Math.exp(-age/(2*DAY));total+=score*weight;weights+=weight;if(score)scored++}
  return {score:weights?bound(total/weights,-1,1):0,count:items.length,scored};
}
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
