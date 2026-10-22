import { DAY, HORIZONS, dailyPrices, forecast } from './forecast-model';
import type { Daily } from './forecast-model';
export const MAX_EVALUATION_FOLDS=12;
export const MAX_CANDIDATE_ATTEMPTS=48;
export const DIRECTION_FLAT_TOLERANCE_PERCENT=.1;
export type EvaluationPrediction={middle:number;lower:number;upper:number};
export type HistoricalCandidate=(training:readonly Readonly<Daily>[],anchor:number,horizonDays:number,originTime:number)=>EvaluationPrediction;
export type EvaluationFold={originTime:number;targetTime:number;actualTime:number;targetOffsetMs:number;trainingStart:number;trainingEnd:number;trainingObservations:number;anchor:number;actual:number;prediction:EvaluationPrediction};
type EvaluationOptions={asOf?:number;maxFolds?:number;targetToleranceMs?:number;candidate?:HistoricalCandidate};
export type EvaluationMetrics={mae:number;mapePercent:number;directionAccuracyPercent:number};
const classify=(changePercent:number)=>changePercent>DIRECTION_FLAT_TOLERANCE_PERCENT?1:changePercent< -DIRECTION_FLAT_TOLERANCE_PERCENT?-1:0;
const priceOnlyCandidate:HistoricalCandidate=(training,anchor,days,time)=>forecast([...training],anchor,days,{},time);
function nearestObservation(history:Daily[],time:number,tolerance:number):Daily|undefined {
 let lo=0,hi=history.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(history[mid].time<time)lo=mid+1;else hi=mid}
 // Ties choose the earlier observation. No interpolation and no later-than-asOf data.
 return [history[lo-1],history[lo]].filter((p):p is Daily=>!!p&&Math.abs(p.time-time)<=tolerance).sort((a,b)=>Math.abs(a.time-time)-Math.abs(b.time-time)||a.time-b.time)[0];
}
function metrics(folds:EvaluationFold[],baseline:boolean):EvaluationMetrics|null {
 if(!folds.length)return null;
 let absolute=0,percentage=0,correct=0;
 for(const row of folds){const prediction=baseline?row.anchor:row.prediction.middle;absolute+=Math.abs(prediction-row.actual);percentage+=Math.abs(prediction-row.actual)/row.actual*100;if(classify((prediction/row.anchor-1)*100)===classify((row.actual/row.anchor-1)*100))correct++}
 return {mae:absolute/folds.length,mapePercent:percentage/folds.length,directionAccuracyPercent:correct/folds.length*100};
}
/** Price-only, fixed-parameter walk-forward evaluation. Callback candidates must use
 * only the supplied historical training arguments; no news/context snapshots exist.
 * A fold targets origin + horizon calendar duration, never an array-index offset.
 * Observed targets may differ by at most the disclosed tolerance. Fold interiors
 * do not overlap; adjacent folds may share the boundary observation. No tuning or
 * candidate selection happens here. Results do not establish a predictive edge.
 */
export function evaluateForecastHorizon(points:Daily[],horizonDays:number,options:EvaluationOptions={}){
 const horizon=HORIZONS.find(h=>h.days===horizonDays);if(!horizon)throw Error('Unsupported evaluation horizon.');
 const asOf=options.asOf??Date.now(),maxFolds=options.maxFolds??MAX_EVALUATION_FOLDS;
 const targetToleranceMs=options.targetToleranceMs??Math.min(6*3600000,horizonDays*DAY/8);
 if(!Number.isFinite(asOf))throw Error('A finite evaluation as-of timestamp is required.');
 if(!Number.isInteger(maxFolds)||maxFolds<1||maxFolds>MAX_EVALUATION_FOLDS)throw Error('Evaluation permits 1 to 12 folds.');
 if(!Number.isFinite(targetToleranceMs)||targetToleranceMs<0||targetToleranceMs>Math.min(DAY/2,horizonDays*DAY/4))throw Error('Target tolerance is too wide for a dated forecast evaluation.');
 if(points.length>50000)throw Error('Evaluation accepts at most 50000 input observations.');
 // Apply cutoff BEFORE daily aggregation: a later same-day observation must not
 // replace the historical price that was available at this evaluation timestamp.
 const history=dailyPrices(points.filter(p=>Number.isFinite(p.time)&&p.time<=asOf).map(p=>({...p,volume:null})));
 const candidate=options.candidate??priceOnlyCandidate,folds:EvaluationFold[]=[];
 let nextOrigin=Infinity,attempts=0,missingTargets=0,failedCandidates=0;
 for(let index=history.length-1;index>=horizon.min-1&&folds.length<maxFolds&&attempts<MAX_CANDIDATE_ATTEMPTS;index--){
  const origin=history[index],targetTime=origin.time+horizonDays*DAY;
  if(targetTime>asOf||targetTime>nextOrigin)continue;
  const actual=nearestObservation(history,targetTime,targetToleranceMs);
  if(!actual||actual.time<=origin.time){missingTargets++;continue}
  if(Math.max(targetTime,actual.time)>nextOrigin)continue;
  const training=Object.freeze(history.slice(0,index+1).map(p=>Object.freeze({...p})));
  attempts++;
  try{
   const prediction=candidate(training,origin.price,horizonDays,origin.time);
   if(![prediction.middle,prediction.lower,prediction.upper].every(n=>Number.isFinite(n)&&n>0)||prediction.lower>prediction.middle||prediction.middle>prediction.upper)throw Error('Invalid forecast output.');
   folds.push({originTime:origin.time,targetTime,actualTime:actual.time,targetOffsetMs:actual.time-targetTime,trainingStart:training[0].time,trainingEnd:training.at(-1)!.time,trainingObservations:training.length,anchor:origin.price,actual:actual.price,prediction:{middle:prediction.middle,lower:prediction.lower,upper:prediction.upper}});
   nextOrigin=origin.time;
  }catch{failedCandidates++}
 }
 folds.reverse();
 const model=metrics(folds,false),flatPrice=metrics(folds,true);
 const covered=folds.filter(r=>r.actual>=r.prediction.lower&&r.actual<=r.prediction.upper).length;
 return {horizonDays,asOf,maxFolds,minTrainingObservations:horizon.min,targetToleranceMs,count:folds.length,status:folds.length>=3?'evaluated' as const:'insufficient-history' as const,folds,model,flatPrice,
  nominalInterval:{levelPercent:80,coveragePercent:folds.length?covered/folds.length*100:null,calibrated:false as const},directionFlatTolerancePercent:DIRECTION_FLAT_TOLERANCE_PERCENT,
  history:{observations:history.length,start:history[0]?.time??null,end:history.at(-1)?.time??null},
  evaluationWindow:folds.length?{start:folds[0].originTime,end:Math.max(folds.at(-1)!.actualTime,folds.at(-1)!.targetTime)}:null,
  attempts,missingTargets,failedCandidates};
}
