import type {SignalItem} from './forecast-model';
const DAY=86400000;
const positive=new Set('approval approved adoption adopt breakthrough bullish gain gains growth grow inflow inflows launch launches partnership rally rallies rebound rebounds recovery recover rises surge surges upgrade win wins'.split(' '));
const negative=new Set('ban banned bearish breach collapse crash crashes decline declines down downgrade exploit exploited falls falling fraud hack hacked hacks lawsuit liquidation liquidations loss losses outflow outflows plunge plunges scam selloff slump slumps theft'.split(' '));
const bound=(n:number)=>Math.max(-1,Math.min(1,n));
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const word=(phrase:string,flags='i')=>new RegExp('(^|[^a-zA-Z0-9])'+escape(phrase)+'(?=$|[^a-zA-Z0-9])',flags);
const ambiguous=new Set('near link sky gate just render rain quant pearl flow'.split(' '));
const cryptoCue=/\b(?:crypto(?:currency)?|blockchain|token|coin|onchain|on-chain|defi|protocol|bitcoin|ethereum|btc|eth|exchange|staking|oracle)\b/i;
const uncertaintyCue=/\b(?:may|might|could|would|if|unless|assuming|rumou?rs?|rumou?red|alleged|unconfirmed|unsubstantiated|speculat\w*|den(?:y|ies|ied)|false)\b|\b(?:no evidence|no confirmation|not confirmed)\b/i;
const knownAssets=['bitcoin','ethereum','solana','chainlink','dogecoin','cardano','litecoin','avalanche','polkadot','ripple','BTC','ETH','SOL','LINK','DOGE','ADA','LTC','AVAX','DOT','XRP'];
const categories={security:/\b(?:hack(?:ed|s)?|breach|exploit(?:ed)?|fraud|scam|theft)\b/i,regulation:/\b(?:regulat\w*|lawsuit|ban(?:ned)?|approval|approved|sec|court)\b/i,upgrade:/\b(?:upgrade|launch(?:es)?|mainnet|fork)\b/i,adoption:/\b(?:adopt(?:ion)?|partnership|payment(?:s)?|integration)\b/i,flows:/\b(?:inflows?|outflows?|liquidations?|fund(?:s)?|etf)\b/i,'market comment':/\b(?:bullish|bearish|gain(?:s)?|rises?|falls?|rall(?:y|ies)|crash(?:es)?|price|market)\b/i};
export type EventCategory=keyof typeof categories;
export type EvidenceClause={snippet:string;entityReason:string;categories:EventCategory[];status:'keyword-scored'|'unscored';reason:string;score:number;cues:string[]};
export type ForecastEvidenceItem=SignalItem&{evidence:{score:number;clauses:EvidenceClause[];categories:EventCategory[];scored:boolean}};
export const FORECAST_SIGNAL_LIMITS={maxItems:1000,maxTextCharacters:6000,maxAgeDays:7,futureGraceMinutes:15,titleDuplicateHours:6} as const;
export const FORECAST_SIGNAL_NOTES='English rules match explicit asset clauses. Event labels describe text cues, not verified events, causal effects or predictive confidence. Unclear attribution, negated events and hypothetical claims are unscored; implicit pronouns may be missed. Keyword scores and 48-hour decay are heuristics.';
/** Retained public keyword helper: negated opinions such as “not bullish” remain negative. */
export function scoreText(text:string):number{
 const tokens=text.toLowerCase().replace(/https?:\/\/\S+/g,' ').match(/[a-z]+/g)||[];let value=0,hits=0;
 tokens.forEach((token,i)=>{let score=positive.has(token)?1:negative.has(token)?-1:0;if(score){if(tokens.slice(Math.max(0,i-3),i).some(t=>['not','no','never','without'].includes(t)))score=-score;value+=score;hits++}});
 return hits?bound(value/Math.sqrt(hits)):0;
}
/** Only recognized tracking keys/hash are discarded; article identity queries survive.
 * Generic root/home URLs are not story identities and therefore do not deduplicate different titles. */
export function canonicalStoryUrl(raw:string):string|null{
 try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol))return null;url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||/^(?:fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key))url.searchParams.delete(key);url.searchParams.sort();url.pathname=url.pathname.replace(/\/$/,'')||'/';return url.pathname==='/'&&!url.search?null:url.toString()}catch{return null}
}
const titleKey=(title:string)=>title.toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function deduplicateForecastEvidence<T extends SignalItem>(items:readonly T[],prior:readonly SignalItem[]=[]):T[]{
 const urls=new Set<string>(),titles=new Map<string,number[]>();
 const accept=(item:SignalItem)=>{const url=canonicalStoryUrl(item.url),title=titleKey(item.title),time=Date.parse(item.date);if(url&&urls.has(url))return false;if(title&&(titles.get(title)||[]).some(previous=>Math.abs(previous-time)<=FORECAST_SIGNAL_LIMITS.titleDuplicateHours*3600000))return false;if(url)urls.add(url);if(title)titles.set(title,[...(titles.get(title)||[]),time]);return true};
 prior.forEach(accept);
 return items.filter(accept);
}
function entityReason(clause:string,name:string,symbol:string):string|null{
 const normalized=name.trim(),ticker=symbol.trim().toUpperCase();
 if(!normalized||!ticker)return null;
 if(new RegExp('(^|[^a-z0-9])\\$'+escape(ticker)+'(?=$|[^a-z0-9])','i').test(clause))return 'Explicit $'+ticker+' cashtag';
 if(!ambiguous.has(normalized.toLowerCase())&&word(normalized).test(clause))return 'Full asset name: '+normalized;
 if(ambiguous.has(normalized.toLowerCase())&&new RegExp('\\b'+escape(normalized)+'\\s+(?:protocol|token|coin|crypto|blockchain|finance)\\b','i').test(clause))return 'Qualified asset name: '+normalized;
 if(word(ticker,'').test(clause)&&cryptoCue.test(clause.replace(word(ticker,'g'),' ')))return 'Uppercase '+ticker+' ticker with crypto context';
 return null;
}
function attributedClause(clause:string,name:string,symbol:string,inheritedUncertainty=false):EvidenceClause|null{
 const entity=entityReason(clause,name,symbol);if(!entity)return null;
 const assertion=clause.replace(/[’‘]/g,"'").replace(/\b(?:isn't|wasn't|weren't|aren't|hasn't|haven't|hadn't|didn't|doesn't|don't|won't|wouldn't|couldn't|can't|cannot)\b/gi,' not ');
 const eventCategories=(Object.entries(categories).filter(([,pattern])=>pattern.test(clause)).map(([key])=>key)) as EventCategory[];
 const tokens=assertion.toLowerCase().replace(/https?:\/\/\S+/g,' ').match(/[a-z]+/g)||[];
 const cues=tokens.filter(token=>positive.has(token)||negative.has(token));
 const uncertain=inheritedUncertainty||uncertaintyCue.test(clause)||clause.trim().endsWith('?');
 const negatedEvent=cues.some(cue=>!['bullish','bearish'].includes(cue)&&new RegExp('\\b(?:not|no|never|without)\\b(?:\\s+\\w+){0,3}\\s+'+escape(cue)+'\\b','i').test(assertion))||/\b(?:hack|breach|approval|ban|exploit)\b.{0,30}\b(?:denied|false|not confirmed|did not happen)\b/i.test(clause);
 const other=knownAssets.some(asset=>asset.toLowerCase()!==name.toLowerCase()&&asset.toLowerCase()!==symbol.toLowerCase()&&word(asset,asset===asset.toUpperCase()?'':'i').test(clause));
 const conflicting=other&&cues.length>0;
 let reason=uncertain?'Hypothetical, conditional or unconfirmed claim':negatedEvent?'Negated or denied event cue':conflicting?'Multiple assets in one clause; attribution unclear':cues.length?'Selected-asset clause, English keyword fallback':'No directional keyword cue';
 const score=uncertain||negatedEvent||conflicting?0:scoreText(assertion);
 return {snippet:clause,entityReason:entity,categories:eventCategories,status:score?'keyword-scored':'unscored',reason,score,cues:[...new Set(cues)]};
}
export function selectForecastEvidence(items:readonly SignalItem[],name:string,symbol:string,now=Date.now()):ForecastEvidenceItem[]{
 if(!Number.isFinite(now)||!name?.trim()||!symbol?.trim())return [];
 const selected:ForecastEvidenceItem[]=[];
 for(const item of items.slice(0,FORECAST_SIGNAL_LIMITS.maxItems)){
  if(!item||typeof item.title!=='string'||typeof item.url!=='string'||typeof item.date!=='string'||typeof item.source!=='string')continue;
  const time=Date.parse(item.date);if(!Number.isFinite(time)||time>now+15*60000||now-time>7*DAY)continue;
  try{if(!['http:','https:'].includes(new URL(item.url).protocol))continue}catch{continue}
  // Only explicitly attributed clauses are scored: conjunctions/pronouns are not inferred.
  const sentences=(item.title+'\n'+(typeof item.text==='string'?item.text:'')).slice(0,FORECAST_SIGNAL_LIMITS.maxTextCharacters).replace(/https?:\/\/\S+/g,' ').split(/(?:\n|(?<=[.!?;])(?:\s+|$))/);
  const clauses=sentences.flatMap(sentence=>{
   const parts=sentence.split(/(?:,|\b(?:while|whereas|but|and|after|despite|although|however)\b)/i).map(text=>text.trim()).filter(Boolean);
   // A qualifier in the leading clause scopes the rest of that sentence. A later
   // “despite rumours” clause cannot retroactively negate an explicit assertion.
   const inheritedUncertainty=sentence.trim().endsWith('?')||uncertaintyCue.test(parts[0]||'');
   return parts.map(text=>attributedClause(text,name,symbol,inheritedUncertainty)).filter((clause):clause is EvidenceClause=>!!clause);
  });
  if(!clauses.length)continue;
  const unique=[...new Map(clauses.map(clause=>[titleKey(clause.snippet),clause])).values()];
  // Average explicitly matched clauses; unavailable/unscored clauses contribute zero, never an opposite event.
  const score=bound(unique.reduce((sum,clause)=>sum+clause.score,0)/unique.length);
  selected.push({...item,evidence:{score,clauses:unique,categories:[...new Set(unique.flatMap(clause=>clause.categories))],scored:score!==0}});
 }
 return deduplicateForecastEvidence(selected);
}
export function summarizeForecastSentiment(items:readonly SignalItem[],now=Date.now()){
 let total=0,weights=0,scored=0;
 for(const item of items){const time=Date.parse(item.date);if(!Number.isFinite(time)||time>now+15*60000||now-time>7*DAY)continue;const evidence=(item as ForecastEvidenceItem).evidence;const score=evidence?evidence.score:scoreText(item.title+' '+(item.text||''));const age=Math.max(0,now-time),weight=Math.exp(-age/(2*DAY));total+=score*weight;weights+=weight;if(score)scored++}
 return {score:weights?bound(total/weights):0,count:items.length,scored};
}
