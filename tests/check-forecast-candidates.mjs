import assert from 'node:assert/strict';
import {PRICE_METHODS,CANDIDATE_LIMITS,projectPriceCandidate,projectPriceHorizons,comparePriceCandidates} from '../app/forecast-candidates.ts';
import {DAY,forecast} from '../app/forecast-model.ts';
import {evaluateForecastHorizon} from '../app/forecast-evaluation.ts';
const T=Date.UTC(2026,0,1),eps=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const regular=(n,slope=0)=>Array.from({length:n},(_,i)=>({time:T+i*DAY,price:100*Math.exp(slope*i)}));
// Independent analytic fixture: irregular elapsed dates still recover exact log-price slope.
const elapsed=[0,1,2,4,7,8,12,16,20,23,27,30];
for(const slope of [-.002,0,.002]){
 const points=elapsed.map(d=>({time:T+d*DAY,price:100*Math.exp(slope*d)})),origin=points.at(-1).time;
 for(const method of ['trend-30','trend-90']){
  const p=projectPriceCandidate(method,points,250,1,origin);
  eps(p.fit.rawSlope,slope);eps(p.middle,250*Math.exp(slope));
  assert.equal(p.points[0].middle,250);assert.equal(p.points[0].time,origin);assert.equal(p.time,origin+DAY);
  assert.equal(p.fit.observations,elapsed.length);assert.equal(p.fit.spanDays,30);
  assert.equal(p.fit.partialWindow,method==='trend-90');
 }
}
const history=regular(365,.001),origin=history.at(-1).time,anchor=history.at(-1).price;
for(const method of PRICE_METHODS){
 const horizons=projectPriceHorizons(method.id,history,anchor,origin);
 assert.deepEqual(horizons.map(p=>p.h.days),[1,7,30,90,365]);
 for(const p of horizons){assert.ok(p.result,p.error);assert.equal(p.result.points[0].middle,anchor);assert.equal(p.result.points[0].time,origin);assert.equal(p.result.time,origin+p.h.days*DAY);assert.equal(p.result.nominalInterval.calibrated,false);for(const row of p.result.points){assert.ok(row.lower>0&&row.lower<=row.middle&&row.middle<=row.upper&&Number.isFinite(row.upper))}}
}
const baseline=projectPriceCandidate('damped',history,anchor,30,origin);
assert.deepEqual(baseline.points,forecast(history,anchor,30,{},origin).points);
const unchanged=projectPriceCandidate('unchanged',history,anchor,30,origin);assert.ok(unchanged.points.every(p=>p.middle===anchor));
// Calendar-window exclusion (not last 30 rows) and before-origin cutoff happen before aggregation.
const irregular=regular(100,.002).filter((_,i)=>i%2===0||i===99),end=irregular.at(-1).time;
const normal=projectPriceCandidate('trend-30',irregular,200,7,end);
assert.ok(normal.fit.start>=end-30*DAY);assert.ok(normal.fit.observations<30);eps(normal.fit.rawSlope,.002);
const withFuture=[...irregular,{time:end+3600000,price:1e200},{time:end+DAY,price:1e200},{time:NaN,price:9},{time:end-7*DAY,price:-1}];
assert.deepEqual(projectPriceCandidate('trend-30',withFuture,200,7,end),normal);
const recentOnly=regular(8,.001);recentOnly[0].time=T+.75*DAY;
assert.throws(()=>projectPriceCandidate('trend-90',recentOnly,100,1,T+7*DAY),/spanning 7 days/);
assert.throws(()=>projectPriceCandidate('trend-30',regular(6),100,1,T+8*DAY),/8 daily/);
const steep=projectPriceCandidate('trend-30',regular(40,.02),100,1,T+39*DAY);
assert.equal(steep.fit.slopeCapped,true);eps(steep.fit.usedSlope,CANDIDATE_LIMITS.maxAbsoluteLogSlopePerDay);eps(steep.middle,100*Math.exp(.006));
const shock=regular(365);shock[360]={...shock[360],price:1e300};
assert.throws(()=>projectPriceCandidate('trend-30',shock,100,365,T+364*DAY),/finite numeric limits/);
const falling=projectPriceCandidate('trend-90',regular(100,-.02),100,1,T+99*DAY);
assert.equal(falling.fit.slopeCapped,true);eps(falling.fit.usedSlope,-.006);assert.ok(falling.middle<100);
for(const bad of [NaN,0,-1,Infinity])assert.throws(()=>projectPriceCandidate('unchanged',history,bad,1,origin),/positive reference/);
assert.throws(()=>projectPriceCandidate('trend-30',history,100,2,origin),/Unsupported forecast horizon/);
assert.throws(()=>projectPriceCandidate('trend-30',history,100,1,NaN),/origin timestamp/);
assert.throws(()=>projectPriceCandidate('trend-30',Array(50001).fill(history[0]),100,1,origin),/50000/);
// Every method uses the existing evaluator's exact fixed folds, including shifted timestamps.
const sixty=regular(60,.001).map(p=>({...p,time:p.time+3*3600000})),asOf=sixty.at(-1).time;
const comparison=comparePriceCandidates(sixty,7,{asOf});
const eligible=evaluateForecastHorizon(sixty,7,{asOf,candidate:(_t,a)=>({middle:a,lower:a,upper:a})});
assert.equal(comparison.status,'evaluated');assert.equal(comparison.count,6);
assert.deepEqual(comparison.folds.map(f=>[f.originTime,f.actualTime]),eligible.folds.map(f=>[f.originTime,f.actualTime]));
for(const method of comparison.methods){assert.equal(method.count,comparison.count);assert.equal(method.failedCount,0);assert.ok(method.metrics);assert.ok(Number.isFinite(method.metrics.mae));assert.equal(method.nominalInterval.calibrated,false)}
for(const fold of comparison.folds){assert.deepEqual(Object.keys(fold.predictions),PRICE_METHODS.map(m=>m.id));assert.equal(fold.trainingEnd,fold.originTime);assert.ok(fold.actualTime>fold.originTime)}
for(let i=1;i<comparison.folds.length;i++)assert.ok(Math.max(comparison.folds[i-1].actualTime,comparison.folds[i-1].targetTime)<=comparison.folds[i].originTime);
const naiveMetric=comparison.methods.find(m=>m.id==='unchanged').metrics;
const expectedMAE=comparison.folds.reduce((sum,f)=>sum+Math.abs(f.actual-f.anchor),0)/comparison.count;eps(naiveMetric.mae,expectedMAE);
// In a known positive exponential trend, OLS predicts the observed point exactly without tuning.
assert.ok(comparison.methods.find(m=>m.id==='trend-30').metrics.mapePercent<1e-10);
assert.ok(naiveMetric.mapePercent>0);
assert.deepEqual(comparePriceCandidates([...sixty,{time:asOf+3600000,price:1e200}],7,{asOf}),comparison);
// Sparse recent windows fail only trend-30, but are excluded from ALL scored rows.
const sparse=[...regular(100,.001),...Array.from({length:20},(_,i)=>({time:T+(109+i*10)*DAY,price:110+i}))];
const partial=comparePriceCandidates(sparse,30,{asOf:sparse.at(-1).time});
assert.ok(partial.excludedFoldCount>0);assert.ok(partial.methods.find(m=>m.id==='trend-30').failedCount>0);
assert.equal(partial.eligibleCount-partial.excludedFoldCount,partial.count);
for(const method of partial.methods)assert.equal(method.count,partial.count);
for(const fold of partial.folds)assert.equal(Object.keys(fold.predictions).length,4);
const yearly=comparePriceCandidates(history,365,{asOf:origin});
assert.equal(yearly.status,'insufficient-common-history');assert.equal(yearly.count,0);assert.ok(yearly.methods.every(m=>m.metrics===null&&m.nominalInterval.coveragePercent===null));
const short=projectPriceHorizons('trend-90',regular(30),100,T+29*DAY);assert.equal(short.at(-1).result,null);assert.match(short.at(-1).error,/181 daily/);
console.log('Fixed price methods, analytic irregular log trends, anchored dated paths, safety guards, common-fold comparison, failures, future cutoff and insufficient yearly evaluation: passed.');
