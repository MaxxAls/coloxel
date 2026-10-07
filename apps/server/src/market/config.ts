/**
 * Market rules. The values are provisional (docs/phase-3-beta-fermee.md): they can be changed with
 * environment variables during the beta without touching the code. Read on every call.
 */
export interface MarketConfig {
  /** Share of the price destroyed on each sale, in percent. */
  commissionPercent: number;
  /** Share of the price paid to the creator on each resale, in percent. */
  royaltyPercent: number;
  minPrice: number;
  maxPrice: number;
  listingDays: number;
  maxActiveListings: number;
}

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
};

export function marketConfig(): MarketConfig {
  return {
    commissionPercent: number('MARKET_COMMISSION_PERCENT', 5),
    royaltyPercent: number('MARKET_ROYALTY_PERCENT', 5),
    minPrice: Math.max(1, Math.floor(number('MARKET_MIN_PRICE', 1))),
    maxPrice: Math.floor(number('MARKET_MAX_PRICE', 100_000)),
    listingDays: Math.max(1, Math.floor(number('MARKET_LISTING_DAYS', 7))),
    maxActiveListings: Math.max(1, Math.floor(number('MARKET_MAX_LISTINGS', 20))),
  };
}

export interface SaleSplit {
  commission: number;
  royalty: number;
  sellerNet: number;
}

/**
 * Where a price goes. Whole Coloxs only: the commission and the royalty are rounded down, the rest
 * stays with the seller. No royalty when the creator is one of the two parties (selling or buying
 * their own creation): the creator would be paying themselves.
 */
export function splitSale(price: number, creatorIsParty: boolean, config: MarketConfig = marketConfig()): SaleSplit {
  const commission = Math.floor((price * config.commissionPercent) / 100);
  const royalty = creatorIsParty ? 0 : Math.floor((price * config.royaltyPercent) / 100);
  return { commission, royalty, sellerNet: price - commission - royalty };
}
