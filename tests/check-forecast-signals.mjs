import assert from 'node:assert/strict';
import {canonicalStoryUrl,deduplicateForecastEvidence,selectForecastEvidence,summarizeForecastSentiment,scoreText} from '../app/forecast-signals.ts';
import {relevantItems,sentiment} from '../app/forecast-model.ts';
const NOW=Date.UTC(2026,9,22,12),H=3600000,DAY=24*H;
let serial=0;
const story=(title,extra={})=>({title,source:'Fixture publisher',date:new Date(NOW).toISOString(),url:'https://example.com/story/'+(++serial),...extra});
const evidence=(title,name='Bitcoin',symbol='BTC',extra={})=>selectForecastEvidence([story(title,extra)],name,symbol,NOW)[0];
assert.ok(evidence('Bitcoin falls while Ethereum rises').evidence.score<0);
assert.ok(evidence('Bitcoin falls while Ethereum rises','Ethereum','ETH').evidence.score>0);
assert.ok(evidence('Bitcoin falls. Ethereum gains after upgrade.').evidence.score<0);
assert.equal(evidence('Bitcoin is mentioned. Ethereum gains after upgrade.').evidence.score,0);
assert.equal(evidence('Bitcoin rises against Ethereum').evidence.score,0);
assert.match(evidence('Bitcoin rises against Ethereum').evidence.clauses[0].reason,/attribution unclear/);
for(const [name,symbol] of [['NEAR','NEAR'],['LINK','LINK'],['Sky','SKY'],['Gate','GT']])assert.equal(evidence('We are near the gate; link wins a match under the blue sky',name,symbol),undefined);
assert.ok(evidence('Chainlink gains after oracle upgrade','Chainlink','LINK').evidence.score>0);
assert.ok(evidence('$LINK gains','Chainlink','LINK').evidence.score>0);
assert.ok(evidence('NEAR protocol gains users','NEAR','NEAR').evidence.score>0);
assert.ok(evidence('SKY crypto token gains','Sky','SKY').evidence.score>0);
assert.ok(evidence('BTC gains as crypto market rebounds').evidence.score>0);
assert.equal(evidence('BTC wins a tennis match'),undefined);
assert.equal(evidence('ABTC gains in crypto'),undefined);
assert.equal(evidence('bitcoinish gains'),undefined);
for(const title of ['Bitcoin did not crash',"Bitcoin wasn't hacked",'Bitcoin isn’t hacked','Bitcoin could crash if support fails','Bitcoin hack denied','Bitcoin not approved','Bitcoin has no hack','Bitcoin may win approval','Bitcoin crash?']){
 const item=evidence(title);assert.equal(item.evidence.score,0,title);assert.equal(item.evidence.scored,false);assert.match(item.evidence.clauses[0].reason,/Negated|Hypothetical/);
}
assert.ok(evidence('Bitcoin rises despite rumours of a hack').evidence.score>0);
assert.equal(evidence('Bitcoin gains and Ethereum crashes?').evidence.score,0);
assert.equal(evidence("Bitcoin wasn't hacked and Ethereum wasn't hacked",'Ethereum','ETH').evidence.score,0);
for(const title of ['If Bitcoin rises, Ethereum crashes','Rumors Bitcoin and Ethereum hacked','No evidence that Bitcoin and Ethereum were hacked','It is false that Bitcoin and Ethereum were hacked','Reports deny Bitcoin and Ethereum were hacked','Publisher denies Bitcoin and Ethereum were hacked']){
 const eth=evidence(title,'Ethereum','ETH');assert.equal(eth.evidence.score,0);assert.match(eth.evidence.clauses[0].reason,/Hypothetical/);
}
assert.ok(evidence('Bitcoin rises despite rumours of a hack. Ethereum gains.','Ethereum','ETH').evidence.score>0);
for(const title of ['Bitcoin rises, unless Ethereum crashes','Bitcoin rises, assuming Ethereum gains','Bitcoin rises, unsubstantiated Ethereum hack'])assert.equal(evidence(title,'Ethereum','ETH').evidence.score,0);

const distant='Bitcoin '+Array(70).fill('reported').join(' ')+' hacked';
const distantEvidence=evidence(distant);assert.ok(distantEvidence.evidence.score<0);assert.ok(distantEvidence.evidence.clauses[0].snippet.includes('hacked'));assert.deepEqual(distantEvidence.evidence.clauses[0].cues,['hacked']);

assert.ok(scoreText('Bitcoin is not bullish')<0);
assert.ok(evidence('Bitcoin is not bullish').evidence.score<0);
assert.ok(evidence('Bitcoin hacked').evidence.categories.includes('security'));
assert.ok(evidence('Bitcoin wins court approval').evidence.categories.includes('regulation'));
assert.ok(evidence('Bitcoin upgrade launches').evidence.categories.includes('upgrade'));
assert.ok(evidence('Bitcoin adoption partnership').evidence.categories.includes('adoption'));
assert.ok(evidence('Bitcoin ETF inflows grow').evidence.categories.includes('flows'));
assert.ok(evidence('Bitcoin price gains').evidence.categories.includes('market comment'));
const cue=evidence('Unrelated title','Bitcoin','BTC',{text:'Bitcoin hack denied. Ethereum gains.'});assert.equal(cue.evidence.score,0);assert.equal(cue.evidence.clauses.length,1);assert.equal(cue.evidence.clauses[0].snippet,'Bitcoin hack denied.');
for(const extra of [{date:'invalid'},{date:new Date(NOW-7*DAY-1).toISOString()},{date:new Date(NOW+15*60000+1).toISOString()},{url:'javascript:alert(1)'},{url:'data:text/html,x'},{url:'not a url'}])assert.equal(evidence('Bitcoin gains','Bitcoin','BTC',extra),undefined);
assert.ok(evidence('Bitcoin gains','Bitcoin','BTC',{date:new Date(NOW-7*DAY).toISOString()}));
assert.ok(evidence('Bitcoin gains','Bitcoin','BTC',{date:new Date(NOW+15*60000).toISOString()}));
assert.equal(canonicalStoryUrl('https://example.com/story?a=1&utm_source=x&fbclid=x#news'),'https://example.com/story?a=1');
assert.notEqual(canonicalStoryUrl('https://example.com/?p=1'),canonicalStoryUrl('https://example.com/?p=2'));
assert.equal(canonicalStoryUrl('https://example.com/?utm_source=x#news'),null);
const original='https://example.com/article?id=7&utm_source=x#news';
const duplicates=selectForecastEvidence([story('Bitcoin gains after approval',{url:original}),story('Different rewrite: Bitcoin wins approval',{url:'https://example.com/article?utm_campaign=q&id=7'}),story('Bitcoin gains after approval',{url:'https://syndicated.example/other'})],'Bitcoin','BTC',NOW);
assert.equal(duplicates.length,1);assert.equal(duplicates[0].url,original);
const roots=selectForecastEvidence([story('Bitcoin gains',{url:'https://example.com/'}),story('Bitcoin hacked',{url:'https://example.com/'})],'Bitcoin','BTC',NOW);assert.equal(roots.length,2);
const separate=selectForecastEvidence([story('Bitcoin gains',{url:'https://example.com/?p=1'}),story('Bitcoin hacked',{url:'https://example.com/?p=2'})],'Bitcoin','BTC',NOW);assert.equal(separate.length,2);
const repeated=selectForecastEvidence([story('Bitcoin gains',{date:new Date(NOW-DAY).toISOString()}),story('Bitcoin gains')],'Bitcoin','BTC',NOW);assert.equal(repeated.length,2);
const textDuplicate=evidence('Bitcoin gains','Bitcoin','BTC',{text:'Bitcoin gains'});assert.equal(textDuplicate.evidence.clauses.length,1);
const one=story('Bitcoin gains'),two=story('Bitcoin hacked',{date:new Date(NOW-2*DAY).toISOString()});
const matched=selectForecastEvidence([one,two],'Bitcoin','BTC',NOW),summary=summarizeForecastSentiment(matched,NOW);
assert.ok(Math.abs(summary.score-(1-Math.exp(-1))/(1+Math.exp(-1)))<1e-12);assert.equal(summary.scored,2);
assert.deepEqual(sentiment(relevantItems([one,two],'Bitcoin','BTC',NOW),NOW),summary);
assert.equal(deduplicateForecastEvidence([...matched,...matched]).length,matched.length);
const syndicatedSocial=selectForecastEvidence([story('Bitcoin gains',{url:one.url})],'Bitcoin','BTC',NOW);
assert.equal(deduplicateForecastEvidence(syndicatedSocial,[matched[0]]).length,0); // enabled news takes the single contribution
assert.equal(deduplicateForecastEvidence(syndicatedSocial,[]).length,1); // disabled news must not suppress enabled social
assert.ok(summarizeForecastSentiment(deduplicateForecastEvidence(syndicatedSocial,[]),NOW).score>0);

assert.equal(selectForecastEvidence([one],'Bitcoin','BTC',NaN).length,0);
console.log('Entity-qualified evidence, cross-asset clauses, denials/hypotheticals, event cues, URL/title identity, safe links, date bounds and unchanged 48-hour decay: passed.');
