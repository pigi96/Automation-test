import type { Point } from './market-utils';
export type ComparisonMode='overlap'|'independent';
type Series={points:Point[];provider?:string}|null;
export type ComparisonRow={time:number;[key:string]:number|null};
export type ComparisonSummary={start:number;end:number;startPrice:number;endPrice:number;change:number}|null;
const MINUTE=60000,HOUR=60*MINUTE,DAY=24*HOUR;
export const MAX_COMPARISON_SAMPLES=400;
function clean(points:Point[]):Point[]{return [...new Map(points.filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.price)&&p.price>0).map(p=>[p.time,p])).values()].sort((a,b)=>a.time-b.time)}
function medianCadence(points:Point[]){const gaps=points.slice(1).map((p,i)=>p.time-points[i].time).filter(n=>n>0).sort((a,b)=>a-b);return gaps.length?gaps[Math.floor(gaps.length/2)]:0}
/** Interpolate only between nearby recorded prices. Never extrapolate past coverage. */
function sample(points:Point[],time:number,gapLimit:number):number|null {
 let lo=0,hi=points.length-1;
 while(lo<=hi){const mid=(lo+hi)>>1;if(points[mid].time===time)return points[mid].price;if(points[mid].time<time)lo=mid+1;else hi=mid-1}
 const before=points[hi],after=points[lo];
 if(!before||!after||after.time-before.time>gapLimit)return null;
 return before.price+(after.price-before.price)*(time-before.time)/(after.time-before.time);
}
export function compareHistories(histories:Series[],days:number,mode:ComparisonMode='overlap'){
 const series=histories.map(h=>clean(h?.points||[]));
 const summaries:ComparisonSummary[]=series.map(()=>null);
 const empty=(error:string)=>({rows:[] as ComparisonRow[],summaries,stepMs:0,gapLimitMs:0,gaps:series.map(()=>0),error,window:null as {start:number;end:number}|null,coverageShortened:false});
 const loaded=series.filter(s=>s.length>=2);
 if(!loaded.length)return empty('Select assets with at least two valid historical prices.');
 if(mode==='overlap'&&loaded.length!==series.length)return empty('Shared dates need usable history for every selected asset. Retry the missing source or remove that asset.');
 const start=mode==='overlap'?Math.max(...loaded.map(s=>s[0].time)):Math.min(...loaded.map(s=>s[0].time));
 const end=mode==='overlap'?Math.min(...loaded.map(s=>s.at(-1)!.time)):Math.max(...loaded.map(s=>s.at(-1)!.time));
 if(end<=start)return empty('These assets have no overlapping date range. Try another period or use separate starts.');
 // UTC-aligned sampling follows the observed cadence (capped at two standard
 // intervals so sparse sources still expose gaps), bounded to 400
 // regular samples. At most two recorded endpoints per asset are added only in
 // independent mode. Large gaps remain null even when the grid becomes coarser.
 const base=days<=1?15*MINUTE:days<=7?HOUR:days<=30?6*HOUR:DAY;
 const stepMs=Math.ceil(Math.max(base,...loaded.map(points=>Math.min(medianCadence(points),base*2)),(end-start)/(MAX_COMPARISON_SAMPLES-1))/base)*base;
 const gapLimitMs=Math.min(stepMs*2,base*4);
 const times:number[]=[];
 for(let t=Math.ceil(start/stepMs)*stepMs;t<=end&&times.length<MAX_COMPARISON_SAMPLES;t+=stepMs)times.push(t);
 if(mode==='independent')for(const points of loaded)times.push(points[0].time,points.at(-1)!.time);
 const rows:ComparisonRow[]=[...new Set(times)].sort((a,b)=>a-b).map(time=>{const row:ComparisonRow={time};series.forEach((points,i)=>{row['price'+i]=sample(points,time,gapLimitMs)});return row});
 let visible=rows;
 if(mode==='overlap'){
  const allPresent=(r:ComparisonRow)=>series.every((_,i)=>r['price'+i]!=null);
  const first=rows.findIndex(allPresent),last=rows.findLastIndex(allPresent);
  if(first<0||last<=first)return {...empty('Not enough shared samples for a comparison. Try another period or use separate starts.'),stepMs,gapLimitMs};
  visible=rows.slice(first,last+1);
 }
 series.forEach((points,i)=>{
  if(points.length<2)return;
  const first=mode==='overlap'?visible[0]:visible.find(r=>r.time===points[0].time);
  const last=mode==='overlap'?visible.at(-1):visible.find(r=>r.time===points.at(-1)!.time);
  const startPrice=first?.['price'+i],endPrice=last?.['price'+i];
  if(!first||!last||startPrice==null||endPrice==null)return;
  summaries[i]={start:first.time,end:last.time,startPrice,endPrice,change:(endPrice/startPrice-1)*100};
  for(const row of visible){const price=row['price'+i];row['coin'+i]=price==null?null:(price/startPrice-1)*100}
 });
 const gaps=series.map((points,i)=>points.length<2?0:visible.filter(r=>r.time>=points[0].time&&r.time<=points.at(-1)!.time&&r['price'+i]==null).length);
 const window=mode==='overlap'?{start:visible[0].time,end:visible.at(-1)!.time}:null;
 const coverageShortened=!!window&&(window.end-window.start<days*DAY*.9);
 return {rows:visible,summaries,stepMs,gapLimitMs,gaps,error:'',window,coverageShortened};
}

/** A lone recorded/resampled point needs a marker because no line segment reaches it. */
export function isIsolatedComparisonPoint(rows:ComparisonRow[],index:number,seriesIndex:number):boolean {
 const key='coin'+seriesIndex;
 return rows[index]?.[key]!=null&&rows[index-1]?.[key]==null&&rows[index+1]?.[key]==null;
}
