import assert from 'node:assert/strict';
import {capturePriceSnapshot,resolveForecastReference,expiredReferenceHorizon,resolveForecastContext,REFERENCE_GRACE_MS,CONTEXT_FEAR_MAX_AGE_MS,CONTEXT_GLOBAL_MAX_AGE_MS} from '../app/forecast-reference.ts';
import {forecast,DAY} from '../app/forecast-model.ts';
const T=Date.UTC(2026,9,22,12),M=60000,H=3600000;
const coin={id:'bitcoin',name:'Bitcoin',symbol:'btc',current_price:100};
const history={assetId:'bitcoin',points:Array.from({length:365},(_,i)=>({time:T-(364-i)*DAY-H,price:80+i/10}))};
const first=capturePriceSnapshot({...coin,last_updated:new Date(T-M).toISOString()},T);
assert.deepEqual(first,{assetId:'bitcoin',price:100,time:T-M,receivedAt:T,timeSource:'provider'});
const a=resolveForecastReference('bitcoin',first,history,true,T);
assert.equal(a.price,100);assert.equal(a.time,T-M);assert.equal(a.cached,false);
const second=capturePriceSnapshot({...coin,current_price:120,last_updated:new Date(T+4*M).toISOString()},T+5*M);
const b=resolveForecastReference('bitcoin',second,history,true,T+5*M);
assert.equal(b.price,120);assert.equal(b.time,T+4*M);assert.notEqual(b.time,a.time);
for(const days of [1,7,30,90,365]){
 const f=forecast(history.points,b.price,days,{},b.time);
 assert.equal(f.points[0].middle,120);assert.equal(f.points[0].time,T+4*M);assert.equal(f.time,b.time+days*DAY);
}
const received=capturePriceSnapshot(coin,T);assert.equal(received.time,T);assert.equal(received.timeSource,'received');
for(const stamp of ['invalid',new Date(T+M).toISOString()]){const p=capturePriceSnapshot({...coin,last_updated:stamp},T);assert.equal(p.time,T);assert.equal(p.timeSource,'received')}
assert.equal(capturePriceSnapshot({...coin,current_price:NaN},T),null);assert.equal(capturePriceSnapshot(coin,NaN),null);
// Failed/offline market snapshots cannot re-anchor an old price to today's time.
const offline=resolveForecastReference('bitcoin',second,history,false,T+5*M);
assert.equal(offline.price,history.points.at(-1).price);assert.equal(offline.time,T-H);assert.equal(offline.cached,true);assert.equal(offline.source,'history');
const aged=resolveForecastReference('bitcoin',first,history,true,T+REFERENCE_GRACE_MS);
assert.equal(aged.source,'history');
const staleProvider=capturePriceSnapshot({...coin,last_updated:new Date(T-2*DAY).toISOString()},T);
assert.equal(resolveForecastReference('bitcoin',staleProvider,history,true,T).source,'history');
// Asset-switch boundary: both old snapshot and any delayed old history must be
// ignored for the selected asset, including while the next history is pending.
const ethSnapshot=capturePriceSnapshot({...coin,id:'ethereum',current_price:2500},T+M);
assert.equal(resolveForecastReference('ethereum',first,history,true,T+M),null);
assert.equal(resolveForecastReference('ethereum',ethSnapshot,history,true,T+M).price,2500);
assert.equal(resolveForecastReference('ethereum',ethSnapshot,history,false,T+M),null);
const ethHistory={assetId:'ethereum',points:[{time:T-H,price:2400}]};
assert.equal(resolveForecastReference('ethereum',null,ethHistory,false,T+M).price,2400);
assert.equal(resolveForecastReference('bitcoin',null,{assetId:'bitcoin',points:[{time:NaN,price:100},{time:T+H,price:500},{time:T-H,price:90},{time:T-M,price:-1}]},false,T).price,90);
assert.equal(resolveForecastReference('bitcoin',null,null,false,T),null);
assert.equal(expiredReferenceHorizon({...offline,time:T-2*DAY},1,T),true);
assert.equal(expiredReferenceHorizon({...offline,time:T-DAY},1,T),true);
assert.equal(expiredReferenceHorizon({...offline,time:T-H},1,T),false);
assert.equal(expiredReferenceHorizon({...offline,time:T-2*DAY},7,T),false);
const context={updatedAt:new Date(T).toISOString(),global:{change:4,timestamp:T/1000},fear:{value:75,time:T-12*H}};
const current=resolveForecastContext(context,T);assert.equal(current.available,true);assert.equal(current.score,.5);assert.equal(current.globalAvailable,true);assert.equal(current.fearAvailable,true);
for(const unavailable of [{...context,failed:true},{...context,stale:true},{...context,updatedAt:new Date(T-REFERENCE_GRACE_MS-1).toISOString()},null]){const c=resolveForecastContext(unavailable,T);assert.equal(c.available,false);assert.equal(c.score,0)}
const failedRetained={...context,failed:true,stale:true};assert.equal(resolveForecastContext(failedRetained,T+M).score,0);
assert.equal(resolveForecastContext({...context,updatedAt:new Date(T+5*M).toISOString(),global:{change:8,timestamp:(T+5*M)/1000}},T+5*M).score,.9);
const dailyFear=resolveForecastContext({...context,fear:{value:75,time:T-36*H}},T);assert.equal(dailyFear.fearAvailable,true);
const oldFear=resolveForecastContext({...context,fear:{value:75,time:T-CONTEXT_FEAR_MAX_AGE_MS-1}},T);assert.equal(oldFear.fearAvailable,false);assert.equal(oldFear.score,.4);
const oldGlobal=resolveForecastContext({...context,global:{change:4,timestamp:(T-CONTEXT_GLOBAL_MAX_AGE_MS-1)/1000}},T);assert.equal(oldGlobal.globalAvailable,false);assert.equal(oldGlobal.fearAvailable,true);assert.equal(oldGlobal.score,.1);
assert.equal(resolveForecastContext({...context,global:{change:NaN},fear:{value:150}},T).available,false);
assert.equal(resolveForecastContext({global:{change:4},fear:{value:75}},T).available,false);
console.log('Atomic price/time updates, cached expiry, selected-asset boundaries and failed/stale per-source context exclusion: passed.');
