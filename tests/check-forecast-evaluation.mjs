import assert from 'node:assert/strict';
import {evaluateForecastHorizon,MAX_EVALUATION_FOLDS,MAX_CANDIDATE_ATTEMPTS} from '../app/forecast-evaluation.ts';
import {DAY,HORIZONS} from '../app/forecast-model.ts';
const T=Date.UTC(2022,0,1),hour=3600000;
const observations=(count,step=DAY,price=i=>100+i)=>Array.from({length:count},(_,i)=>({time:T+i*step,price:price(i)}));
const ideal=(training,anchor,days,origin)=>{assert.equal(training.at(-1).time,origin);assert.ok(training.every(p=>p.time<=origin));assert.equal(anchor,training.at(-1).price);assert.equal(Object.isFrozen(training),true);return {middle:anchor+days,lower:anchor+days,upper:anchor+days}};
const increasing=observations(1600);
for(const horizon of HORIZONS){
 const result=evaluateForecastHorizon(increasing,horizon.days,{asOf:increasing.at(-1).time,candidate:ideal});
 assert.ok(result.count>=3&&result.count<=MAX_EVALUATION_FOLDS);assert.equal(result.status,'evaluated');
 assert.equal(result.model.mae,0);assert.equal(result.model.mapePercent,0);assert.equal(result.model.directionAccuracyPercent,100);assert.equal(result.nominalInterval.coveragePercent,100);assert.equal(result.nominalInterval.calibrated,false);
 for(const row of result.folds){assert.equal(row.targetTime,row.originTime+horizon.days*DAY);assert.equal(row.actualTime,row.targetTime);assert.ok(row.trainingObservations>=horizon.min);assert.equal(row.trainingEnd,row.originTime)}
 for(let i=1;i<result.folds.length;i++)assert.ok(Math.max(result.folds[i-1].targetTime,result.folds[i-1].actualTime)<=result.folds[i].originTime,'Evaluation windows must not overlap');
}
// Independently specified calendar-fold counts (not implementation snapshots).
const forty=observations(40);
const oneDayCount=evaluateForecastHorizon(forty,1,{asOf:forty.at(-1).time});
assert.equal(oneDayCount.count,12);assert.deepEqual(oneDayCount.folds.map(r=>(r.originTime-T)/DAY),Array.from({length:12},(_,i)=>27+i));
const sixty=observations(60);
const sevenDayCount=evaluateForecastHorizon(sixty,7,{asOf:sixty.at(-1).time});
assert.equal(sevenDayCount.count,6);assert.deepEqual(sevenDayCount.folds.map(r=>(r.originTime-T)/DAY),[17,24,31,38,45,52]);
const edge=observations(10);
const tolerated=[...edge,{time:T+10*DAY+3*hour,price:110}];
const toleranceResult=evaluateForecastHorizon(tolerated,1,{asOf:T+11*DAY});
assert.equal(toleranceResult.count,3);assert.equal(toleranceResult.folds.at(-1).targetOffsetMs,3*hour);
const outside=[...edge,{time:T+10*DAY+3*hour+1,price:110}];
assert.equal(evaluateForecastHorizon(outside,1,{asOf:T+11*DAY}).count,2);
const atNoon=observations(11),noon=T+10*DAY+12*hour;
assert.deepEqual(evaluateForecastHorizon([...atNoon,{time:T+10*DAY+16*hour,price:1e8}],1,{asOf:noon}),evaluateForecastHorizon(atNoon,1,{asOf:noon}));
// Sparse rows do not redefine one calendar day as the next array entry.
const everyTwoDays=observations(90,2*DAY,i=>100+2*i);
assert.equal(evaluateForecastHorizon(everyTwoDays,1,{asOf:everyTwoDays.at(-1).time,candidate:ideal}).count,0);
assert.equal(evaluateForecastHorizon(everyTwoDays,7,{asOf:everyTwoDays.at(-1).time,candidate:ideal}).count,0);
const spaced=evaluateForecastHorizon(everyTwoDays,30,{asOf:everyTwoDays.at(-1).time,candidate:ideal});
assert.ok(spaced.count>=3);assert.equal(spaced.model.mae,0);assert.ok(spaced.folds.every(r=>r.actualTime-r.originTime===30*DAY));
// Observed target timestamps may shift slightly, but must remain within the
// explicit tolerance; actual shifted target times govern non-overlap too.
const shifted=observations(100).map((p,i)=>({...p,time:p.time+(i%2)*hour}));
const shiftedResult=evaluateForecastHorizon(shifted,1,{asOf:shifted.at(-1).time});
assert.ok(shiftedResult.count>=3);assert.ok(shiftedResult.folds.some(r=>r.targetOffsetMs!==0));
assert.ok(shiftedResult.folds.every(r=>Math.abs(r.targetOffsetMs)<=shiftedResult.targetToleranceMs));
for(let i=1;i<shiftedResult.folds.length;i++)assert.ok(Math.max(shiftedResult.folds[i-1].targetTime,shiftedResult.folds[i-1].actualTime)<=shiftedResult.folds[i].originTime);
assert.equal(evaluateForecastHorizon(shifted,1,{asOf:shifted.at(-1).time,targetToleranceMs:0}).count,0);
// Future points, including later on the final UTC day, cannot alter either the
// admitted daily history or any training fold/target selected as of the cutoff.
const past=observations(100),asOf=past.at(-1).time;
const baseline=evaluateForecastHorizon(past,7,{asOf});
const polluted=[...past,{time:asOf+hour,price:1e9},{time:asOf+DAY,price:.01},{time:asOf+500*DAY,price:3e9}];
assert.deepEqual(evaluateForecastHorizon(polluted,7,{asOf}),baseline);
const captured=[];evaluateForecastHorizon(polluted,1,{asOf,candidate:(train,anchor,days,time)=>{captured.push(train);assert.ok(train.every(p=>p.time<=time&&p.time<=asOf));return {middle:anchor,lower:anchor,upper:anchor}}});assert.ok(captured.length>0);
const year=evaluateForecastHorizon(observations(365),365,{asOf:T+364*DAY});
assert.equal(year.count,0);assert.equal(year.status,'insufficient-history');assert.equal(year.model,null);assert.equal(year.flatPrice,null);assert.equal(year.nominalInterval.coveragePercent,null);
// Direction uses up/down/flat categories. A move within +/-0.1% counts as flat,
// so a flat-price benchmark is correct only when the realized move is flat.
const flat=observations(60,DAY,()=>110),flatAsOf=flat.at(-1).time;
const good=evaluateForecastHorizon(flat,1,{asOf:flatAsOf});assert.equal(good.model.mae,0);assert.equal(good.flatPrice.directionAccuracyPercent,100);assert.equal(good.model.directionAccuracyPercent,100);
const wrong=evaluateForecastHorizon(flat,1,{asOf:flatAsOf,candidate:()=>({middle:100,lower:90,upper:105})});
assert.equal(wrong.model.mae,10);assert.ok(Math.abs(wrong.model.mapePercent-10/110*100)<1e-10);assert.equal(wrong.model.directionAccuracyPercent,0);assert.equal(wrong.nominalInterval.coveragePercent,0);assert.equal(wrong.flatPrice.mae,0);
const nearFlat=evaluateForecastHorizon(flat,1,{asOf:flatAsOf,candidate:(_,anchor)=>({middle:anchor*1.0005,lower:anchor*.99,upper:anchor*1.01})});assert.equal(nearFlat.model.directionAccuracyPercent,100);
const failed=evaluateForecastHorizon(observations(100),1,{asOf:T+99*DAY,candidate:()=>{throw Error('fit failed')}});assert.equal(failed.attempts,MAX_CANDIDATE_ATTEMPTS);assert.equal(failed.failedCandidates,MAX_CANDIDATE_ATTEMPTS);assert.equal(failed.count,0);
assert.equal(evaluateForecastHorizon(flat,1,{asOf:flatAsOf,maxFolds:3}).count,3);
assert.throws(()=>evaluateForecastHorizon(flat,2),/Unsupported/);assert.throws(()=>evaluateForecastHorizon(flat,1,{maxFolds:13}),/1 to 12/);assert.throws(()=>evaluateForecastHorizon(flat,1,{asOf:NaN}),/finite/);assert.throws(()=>evaluateForecastHorizon(flat,1,{targetToleranceMs:DAY}),/tolerance/);
const dirty=[...flat,{time:NaN,price:5},{time:T,price:-1},{time:T+hour,price:NaN}];assert.equal(evaluateForecastHorizon(dirty,1,{asOf:flatAsOf}).history.observations,60);
console.log('Timestamp walk-forward targets, non-overlap, no lookahead, strict gap tolerance, horizon history, baseline metrics and bounded fits: passed.');
