export type Coin = {
  source_provider?: string; id: string; name: string; symbol: string; image?: string; market_cap_rank: number;
  current_price: number; market_cap: number; total_volume: number; price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number; high_24h?: number; low_24h?: number;
  circulating_supply?: number; max_supply?: number; total_supply?: number; ath?: number;
  ath_change_percentage?: number; fully_diluted_valuation?: number; last_updated?: string;
  sparkline_in_7d?: { price: number[] };
};
export type Point = { time: number; price: number; volume: number | null };
export const usd = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...(Math.abs(n)>=1?{minimumFractionDigits:2,maximumFractionDigits:2}:{maximumSignificantDigits:7}) }).format(n);
export const compactUSD = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
export const percent = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
export function portfolioValue(holdings: { coinId: string; units: number; cost: number }[], coins: Coin[]) {
  return holdings.map(h => {
    const coin = coins.find(c => c.id === h.coinId);
    const price = coin?.current_price;
    const value = price != null && Number.isFinite(price) ? h.units * price : null;
    const invested = h.units * h.cost;
    return { ...h, coin, value, invested, pnl: value == null ? null : value - invested };
  });
}
export function crossing(direction: 'above' | 'below', target: number, price: number) {
  return direction === 'above' ? price >= target : price <= target;
}
export function movingAverage(points: Point[], window = 20) {
  return points.map((point, i) => ({ ...point, average: i + 1 < window ? null : points.slice(i - window + 1, i + 1).reduce((total, p) => total + p.price, 0) / window }));
}
