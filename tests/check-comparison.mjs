import assert from 'node:assert/strict';
import {compareHistories,isIsolatedComparisonPoint,MAX_COMPARISON_SAMPLES} from '../app/comparison-model.ts';
const M=60000,H=60*M,D=24*H,T=Date.UTC(2026,0,1);
const point=(hours,price)=>({time:T+hours*H,price,volume:null});
const series=(hours,fn,provider='CoinGecko')=>({points:hours.map(h=>point(h,fn(h))),provider});
const a=series(Array.from({length:25},(_,i)=>i/4),h=>100+10*h);
const b=series(Array.from({length:24},(_,i)=>i/4+1/12),h=>200+20*h,'Coinbase Exchange');
const shared=compareHistories([a,b],1,'overlap');
assert.equal(shared.error,'');assert.equal(shared.rows[0].time,T+15*M);assert.equal(shared.rows.at(-1).time,T+345*M);
for(const row of shared.rows){assert.ok(Math.abs(row.coin0-row.coin1)<1e-9);assert.ok(row.price0>0&&row.price1>0)}
for(const [i,summary] of shared.summaries.entries()){assert.equal(summary.start,shared.rows[0].time);assert.equal(summary.end,shared.rows.at(-1).time);assert.equal(shared.rows[0]['coin'+i],0);assert.equal(shared.rows.at(-1)['coin'+i],summary.change);assert.equal(summary.change,(summary.endPrice/summary.startPrice-1)*100)}
assert.equal(shared.coverageShortened,true);
const full=series(Array.from({length:169},(_,i)=>i),h=>100+h);
const partial=series(Array.from({length:97},(_,i)=>i+48+1/6),h=>500+h,'Coinbase Exchange');
const partialResult=compareHistories([full,partial],7);
assert.equal(partialResult.error,'');assert.equal(partialResult.window.start,T+49*H);assert.equal(partialResult.window.end,T+144*H);
assert.deepEqual(partialResult.summaries.map(s=>[s.start,s.end]),[[T+49*H,T+144*H],[T+49*H,T+144*H]]);
const dates=Array.from({length:21},(_,i)=>i*24);
const dailyA=series(dates,h=>100+h/24);
const dailyB=series(dates.filter(h=>h<6*24||h>12*24),h=>200+h/24);
const missing=compareHistories([dailyA,dailyB],90);
assert.equal(missing.gapLimitMs,2*D);assert.equal(missing.gaps[1],7);
assert.equal(missing.rows.find(r=>r.time===T+9*D).coin1,null);assert.equal(missing.rows.find(r=>r.time===T+9*D).price1,null);
assert.equal(missing.rows.find(r=>r.time===T+5*D).coin1!=null,true);assert.equal(missing.rows.find(r=>r.time===T+13*D).coin1!=null,true);
const sparse=compareHistories([series([0,24*20],h=>100+h),series([0,24*20],h=>200+h)],90);
assert.ok(sparse.rows.length>2);assert.ok(sparse.rows.slice(1,-1).some(r=>r.coin0===null));
const noOverlap=compareHistories([a,series([24,25],h=>h)],1);
assert.equal(noOverlap.rows.length,0);assert.match(noOverlap.error,/no overlapping/);
const failed=compareHistories([a,null],1);assert.equal(failed.rows.length,0);assert.match(failed.error,/every selected/);
const separate=compareHistories([a,partial],7,'independent');assert.equal(separate.error,'');assert.equal(separate.window,null);
assert.equal(separate.summaries[0].start,a.points[0].time);assert.equal(separate.summaries[1].start,partial.points[0].time);
for(const [i,s] of separate.summaries.entries()){assert.equal(separate.rows.find(r=>r.time===s.start)['coin'+i],0);assert.equal(separate.rows.find(r=>r.time===s.end)['coin'+i],s.change)}
assert.equal(compareHistories([a,null],1,'independent').summaries[1],null);
const many=series(Array.from({length:731},(_,i)=>i*24),h=>100+h/24);
assert.ok(compareHistories([many,many],365).rows.length<=MAX_COMPARISON_SAMPLES);
const dirty={points:[point(1,110),point(0,100),point(1,111),point(2,NaN),point(3,-5),point(4,140)],provider:'fixture'};
const cleaned=compareHistories([dirty,dirty],1,'independent');assert.equal(cleaned.summaries[0].startPrice,100);assert.equal(cleaned.summaries[0].endPrice,140);
assert.equal(compareHistories([],1).rows.length,0);assert.equal(compareHistories([{points:[point(0,1)]}],1).rows.length,0);
console.log('Comparison shared dates, shifted grids, partial coverage, mixed providers, long gaps, endpoint returns, bounds and independent mode: passed.');

const isolated=[{time:T,coin0:0},{time:T+D,coin0:null},{time:T+2*D,coin0:10},{time:T+3*D,coin0:11}];
assert.equal(isIsolatedComparisonPoint(isolated,0,0),true);
assert.equal(isIsolatedComparisonPoint(isolated,1,0),false);
assert.equal(isIsolatedComparisonPoint(isolated,2,0),false);
assert.equal(isIsolatedComparisonPoint(isolated,3,0),false);
assert.equal(isIsolatedComparisonPoint([{time:T,coin0:null},{time:T+D,coin0:0},{time:T+2*D,coin0:null}],1,0),true);
assert.equal(isIsolatedComparisonPoint(isolated,0,1),false);
