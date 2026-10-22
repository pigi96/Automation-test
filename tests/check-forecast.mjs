import assert from 'node:assert/strict';
import {DAY,HORIZONS,dailyPrices,forecast,historicalCheck,relevantItems,sentiment,textScore} from '../app/forecast-model.ts';
const now=Date.now();
const flat=Array.from({length:365},(_,i)=>({time:now-(364-i)*DAY,price:100}));
for(const h of HORIZONS){const f=forecast(flat,100,h.days,{},now);assert.equal(f.middle,100);assert.equal(f.lower,100);assert.equal(f.upper,100);assert.equal(f.points[0].middle,100);assert.equal(f.time,now+h.days*DAY);}
const noisy=flat.map((p,i)=>({...p,price:100*Math.exp(.001*i+.03*Math.sin(i))}));
for(const h of HORIZONS){const f=forecast(noisy,120,h.days,{news:.5,social:-.5,market:.2},now);assert.ok(f.points.every(p=>p.lower>0&&p.lower<=p.middle&&p.middle<=p.upper&&Number.isFinite(p.upper)));assert.equal(f.points[0].middle,120);}
assert.ok(forecast(noisy,120,365).upper/forecast(noisy,120,365).lower>forecast(noisy,120,1).upper/forecast(noisy,120,1).lower);
assert.throws(()=>forecast(flat.slice(0,10),100,365));assert.throws(()=>forecast(flat,-1,1));assert.throws(()=>forecast(flat,100,999));
assert.ok(forecast(flat,100,7,{news:1}).middle>forecast(flat,100,7,{news:0}).middle);
assert.ok(textScore('Bitcoin approval brings inflows')>0);assert.ok(textScore('Bitcoin hack leads to losses')<0);assert.ok(textScore('Bitcoin is not bullish')<0);
const items=[{title:'Bitcoin gains following approval',source:'News',url:'https://example.com/1',date:new Date(now).toISOString()},{title:'Bitcoin gains following approval',source:'Duplicate',url:'https://example.com/2',date:new Date(now).toISOString()},{title:'Other asset rises',source:'News',url:'https://example.com/3',date:new Date(now).toISOString()},{title:'Bitcoin hack',source:'Old',url:'https://example.com/4',date:new Date(now-8*DAY).toISOString()}];
assert.equal(relevantItems(items,'Bitcoin','BTC',now).length,1);assert.ok(sentiment(relevantItems(items,'Bitcoin','BTC',now),now).score>0);
assert.equal(dailyPrices([{time:now,price:100,volume:null},{time:now-1,price:90,volume:null},{time:now,price:NaN,volume:null}]).length,1);
const check=historicalCheck(flat,7);assert.ok(check.count>=3);assert.equal(check.mape,0);assert.equal(check.baseline,0);assert.equal(historicalCheck(flat,365).count,0);
console.log('Forecast horizons, anchoring, finite ordered bounds, uncertainty growth, history requirements, sentiment, source filtering, and rolling baseline checks: passed.');
