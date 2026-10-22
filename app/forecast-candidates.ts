import {DAY,HORIZONS,dailyPrices,fitPriceModel,forecast,type Daily} from './forecast-model';
import {evaluateForecastHorizon,DIRECTION_FLAT_TOLERANCE_PERCENT,type EvaluationFold,type EvaluationMetrics,type EvaluationPrediction} from './forecast-evaluation';
export const PRICE_METHODS=[
 {id:'unchanged',label:'Unchanged price',lookbackDays:null,description:'The supplied reference price at every future date; a simple benchmark.'},
 {id:'damped',label:'Damped momentum',lookbackDays:null,description:'The existing price-only baseline: capped 7/30-day momentum damped over 30 days.'},
 {id:'trend-30',label:'30-day log trend',lookbackDays:30,description:'Least-squares log-price trend over up to 30 elapsed calendar days, anchored to the reference price.'},
 {id:'trend-90',label:'90-day log trend',lookbackDays:90,description:'Least-squares log-price trend over up to 90 elapsed calendar days, anchored to the reference price.'},
] as const;
export type PriceMethodId=typeof PRICE_METHODS[number]['id'];
export const CANDIDATE_LIMITS={maxInputObservations:50000,minTrendObservations:8,minTrendSpanDays:7,maxAbsoluteLogSlopePerDay:.006,maxAbsolutePathLogChange:Math.log(10)} as const;
export const PRICE_METHOD_NOTES={
 source:'https://otexts.com/fpp3/toolbox.html',
 comparison:'Fixed methods, evaluated on the same dated training/target folds. No automatic winner or tuned selection. At least 3 common folds are required for a comparison.',
 trend:'Elapsed-day ordinary least squares of log price, using only observations at or before the origin. Partial windows are disclosed. The intercept is fitted but the projected path starts at the supplied reference price.',
 caps:'Trend slopes are capped at ±0.006 log-price per day and cumulative log-price changes at ±log(10). These fixed heuristic safety assumptions are not learned accuracy guarantees. Invalid or non-finite paths are rejected.',
 interval:'All methods reuse the existing trailing-price volatility and nominal 80% log-normal range heuristic. The range is uncalibrated, is not an OLS prediction interval, and does not account for method uncertainty.',
} as const;
export type CandidateFit={observations:number;start:number;end:number;spanDays:number;lookbackDays:number|null;partialWindow:boolean;rawSlope:number|null;usedSlope:number;slopeCapped:boolean;pathCapped:boolean};
export type PriceCandidateProjection=ReturnType<typeof forecast>&{method:PriceMethodId;fit:CandidateFit;nominalInterval:{levelPercent:80;calibrated:false}};
const clamp=(n:number,b:number)=>Math.max(-b,Math.min(b,n));
const finiteTime=(n:number)=>Number.isFinite(n)&&Number.isFinite(new Date(n).getTime());
function prepared(points:readonly Daily[],origin:number){
 if(!finiteTime(origin))throw Error('A finite, representable origin timestamp is required.');
 if(points.length>CANDIDATE_LIMITS.maxInputObservations)throw Error('Price methods accept at most 50000 input observations.');
 // Cut off BEFORE daily aggregation so a later same-day price cannot replace one available at the origin.
 return dailyPrices(points.filter(p=>finiteTime(p.time)&&p.time<=origin).map(p=>({...p,volume:null})));
}
function project(method:PriceMethodId,training:Daily[],anchor:number,days:number,origin:number):PriceCandidateProjection{
 const definition=PRICE_METHODS.find(m=>m.id===method),horizon=HORIZONS.find(h=>h.days===days);
 if(!definition)throw Error('Unsupported price method.');
 if(!horizon)throw Error('Unsupported forecast horizon.');
 if(!finiteTime(origin+days*DAY))throw Error('Forecast target timestamp exceeds representable date limits.');
 if(!Number.isFinite(anchor)||anchor<=0)throw Error('A finite positive reference price is required.');
 if(training.length<horizon.min)throw Error(`This horizon needs ${horizon.min} daily observations; ${training.length} are available.`);
 const volatility=fitPriceModel(training);
 let window=training.slice(-181),rawSlope:number|null=null,usedSlope=method==='damped'?volatility.drift:0;
 const lookbackDays=definition.lookbackDays;
 if(lookbackDays!==null){
  window=training.filter(p=>p.time>=origin-lookbackDays*DAY);
  const span=window.length?(window.at(-1)!.time-window[0].time)/DAY:0;
  if(window.length<CANDIDATE_LIMITS.minTrendObservations||span<CANDIDATE_LIMITS.minTrendSpanDays)throw Error(`Log trend needs at least 8 daily observations spanning 7 days inside its ${lookbackDays}-day window.`);
  // Center x and y before covariance for numerical stability; x is elapsed real days, never a row index.
  const x=window.map(p=>(p.time-window[0].time)/DAY),y=window.map(p=>Math.log(p.price));
  const meanX=x.reduce((s,v)=>s+v,0)/x.length,meanY=y.reduce((s,v)=>s+v,0)/y.length;
  const variance=x.reduce((s,v)=>s+(v-meanX)**2,0);
  rawSlope=x.reduce((s,v,i)=>s+(v-meanX)*(y[i]-meanY),0)/variance;
  if(!Number.isFinite(rawSlope)||variance<=0)throw Error('Log trend cannot be estimated from these timestamps.');
  usedSlope=clamp(rawSlope,CANDIDATE_LIMITS.maxAbsoluteLogSlopePerDay);
 }
 const fit:CandidateFit={observations:window.length,start:window[0].time,end:window.at(-1)!.time,spanDays:(window.at(-1)!.time-window[0].time)/DAY,lookbackDays,partialWindow:lookbackDays!==null&&(origin-window[0].time)/DAY<lookbackDays,rawSlope,usedSlope,slopeCapped:rawSlope!==null&&usedSlope!==rawSlope,pathCapped:false};
 const nominalInterval={levelPercent:80 as const,calibrated:false as const};
 if(method==='damped')return {...forecast(training,anchor,days,{},origin),method,fit,nominalInterval};
 const steps=days===1?24:days;
 const points=Array.from({length:steps+1},(_,i)=>{
  const t=days*i/steps,rawLog=usedSlope*t,logChange=clamp(rawLog,CANDIDATE_LIMITS.maxAbsolutePathLogChange);
  if(rawLog!==logChange)fit.pathCapped=true;
  const middle=anchor*Math.exp(logChange),width=1.2815515655*volatility.sigma*Math.sqrt(t*(1+t/Math.max(1,volatility.days-1)));
  return {time:origin+t*DAY,middle,lower:middle*Math.exp(-width),upper:middle*Math.exp(width)};
 });
 if(points.some(p=>!finiteTime(p.time)||![p.middle,p.lower,p.upper].every(v=>Number.isFinite(v)&&v>0)||p.lower>p.middle||p.middle>p.upper))throw Error('Price scenario or uncertainty range exceeds finite numeric limits.');
 const end=points.at(-1)!;
 return {...end,points,change:(end.middle/anchor-1)*100,sigma:volatility.sigma,drift:usedSlope,observations:training.length,drivers:{momentum:Math.log(end.middle/anchor),language:0,context:0},method,fit,nominalInterval};
}
export function projectPriceCandidate(method:PriceMethodId,points:readonly Daily[],anchor:number,days:number,origin:number){return project(method,prepared(points,origin),anchor,days,origin)}
/** Return every supported horizon for the explicitly selected method, including honest unavailable states. */
export function projectPriceHorizons(method:PriceMethodId,points:readonly Daily[],anchor:number,origin:number){
 const training=prepared(points,origin);
 return HORIZONS.map(h=>{try{return {h,result:project(method,training,anchor,h.days,origin),error:''}}catch(error){return {h,result:null,error:(error as Error).message}}});
}
export type ComparisonPrediction=EvaluationPrediction&{slopeCapped:boolean;pathCapped:boolean;fit:CandidateFit};
export type PriceComparisonFold=Omit<EvaluationFold,'prediction'>&{predictions:Record<PriceMethodId,ComparisonPrediction>};
const direction=(pct:number)=>pct>DIRECTION_FLAT_TOLERANCE_PERCENT?1:pct< -DIRECTION_FLAT_TOLERANCE_PERCENT?-1:0;
function score(folds:PriceComparisonFold[],method:PriceMethodId):EvaluationMetrics|null{
 if(!folds.length)return null;
 let absolute=0,percentage=0,correct=0;
 for(const f of folds){const predicted=f.predictions[method].middle;absolute+=Math.abs(predicted-f.actual);percentage+=Math.abs(predicted-f.actual)/f.actual*100;if(direction((predicted/f.anchor-1)*100)===direction((f.actual/f.anchor-1)*100))correct++}
 const result={mae:absolute/folds.length,mapePercent:percentage/folds.length,directionAccuracyPercent:correct/folds.length*100};
 return Object.values(result).every(Number.isFinite)?result:null;
}
/** Eligibility is fixed ONCE by the existing timestamp evaluator using a no-fit naive candidate.
 * Candidate failures exclude that fold from ALL scores, without searching for replacement folds.
 * Maximum 12 fixed folds × 4 methods; only training at/before each origin is supplied to fitting.
 */
export function comparePriceCandidates(points:readonly Daily[],days:number,options:{asOf:number;maxFolds?:number;targetToleranceMs?:number}){
 const eligibility=evaluateForecastHorizon([...points],days,{...options,candidate:(_training,anchor)=>({middle:anchor,lower:anchor,upper:anchor})});
 const history=prepared(points,options.asOf);
 const failures:Record<PriceMethodId,{originTime:number;reason:string}[]>={unchanged:[],damped:[],'trend-30':[],'trend-90':[]};
 const folds:PriceComparisonFold[]=[];
 for(const eligible of eligibility.folds){
  const training=history.filter(p=>p.time<=eligible.originTime),predictions={} as Record<PriceMethodId,ComparisonPrediction>;
  for(const method of PRICE_METHODS){try{const prediction=project(method.id,training,eligible.anchor,days,eligible.originTime);predictions[method.id]={middle:prediction.middle,lower:prediction.lower,upper:prediction.upper,slopeCapped:prediction.fit.slopeCapped,pathCapped:prediction.fit.pathCapped,fit:prediction.fit}}catch(error){failures[method.id].push({originTime:eligible.originTime,reason:(error as Error).message})}}
  if(PRICE_METHODS.every(m=>predictions[m.id])){const {prediction:_unused,...shared}=eligible;folds.push({...shared,predictions})}
 }
 const enough=folds.length>=3;
 return {horizonDays:days,asOf:options.asOf,status:enough?'evaluated' as const:'insufficient-common-history' as const,count:folds.length,eligibleCount:eligibility.count,excludedFoldCount:eligibility.count-folds.length,folds,
  methods:PRICE_METHODS.map(method=>{const metrics=score(folds,method.id);return {...method,count:folds.length,metrics:enough?metrics:null,metricsUnavailable:enough&&!metrics,failedCount:failures[method.id].length,failures:failures[method.id],cappedFoldCount:folds.filter(f=>f.predictions[method.id].slopeCapped||f.predictions[method.id].pathCapped).length,nominalInterval:{levelPercent:80 as const,calibrated:false as const,coveragePercent:enough?folds.filter(f=>f.actual>=f.predictions[method.id].lower&&f.actual<=f.predictions[method.id].upper).length/folds.length*100:null}}}),
  minTrainingObservations:eligibility.minTrainingObservations,targetToleranceMs:eligibility.targetToleranceMs,directionFlatTolerancePercent:DIRECTION_FLAT_TOLERANCE_PERCENT,history:eligibility.history,eligibilityAttempts:eligibility.attempts,missingTargets:eligibility.missingTargets,
  evaluationWindow:folds.length?{start:folds[0].originTime,end:Math.max(folds.at(-1)!.targetTime,folds.at(-1)!.actualTime)}:null,notes:PRICE_METHOD_NOTES};
}
