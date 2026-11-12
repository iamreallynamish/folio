/**
 * Merchant dictionary: maps raw card descriptors to a canonical merchant, a category and a kind.
 * `kind: "topup"` marks stored-value wallets — money moved, not yet spent.
 */
export interface MerchantMatch {
  name: string;
  key: string;
  category: string; // key into DEFAULT_CATEGORIES
  subcategory?: string;
  kind: "expense" | "topup" | "transfer";
  /** For top-ups: the wallet the money moves into. */
  wallet?: string;
  known: boolean;
}

interface Rule { re: RegExp; name: string; category: string; subcategory?: string; kind?: "topup" | "transfer"; wallet?: string }

// Order matters: more specific patterns first (Uber Eats before Uber, Amazon Prime before Amazon).
const RULES: Rule[] = [
  // Stored-value wallets and transit cards
  { re: /\b(mobile\s*)?suica\b/i, name: "Mobile Suica", category: "topup", kind: "topup", wallet: "Mobile Suica" },
  { re: /\bpasmo\b/i, name: "PASMO", category: "topup", kind: "topup", wallet: "PASMO" },
  { re: /\bicoca\b/i, name: "ICOCA", category: "topup", kind: "topup", wallet: "ICOCA" },
  { re: /\bpaypay\b/i, name: "PayPay", category: "topup", kind: "topup", wallet: "PayPay" },
  { re: /\bpaytm\s*(wallet|add\s*money)\b/i, name: "Paytm Wallet", category: "topup", kind: "topup", wallet: "Paytm Wallet" },
  { re: /\bamazon\s*pay\s*(balance|add|top)/i, name: "Amazon Pay balance", category: "topup", kind: "topup", wallet: "Amazon Pay balance" },
  { re: /\b(atm|cash)\s*(wdl|withdrawal|w\/d)\b|\batm\b.*\bwithdr/i, name: "ATM withdrawal", category: "transfer", kind: "transfer", wallet: "Cash" },

  // Food & beverage
  { re: /\buber\s*\*?\s*eats\b/i, name: "Uber Eats", category: "food", subcategory: "Delivery" },
  { re: /\bstarbucks\b/i, name: "Starbucks", category: "food", subcategory: "Coffee" },
  { re: /\b(doutor|tully'?s|komeda|blue\s*bottle)\b/i, name: "Coffee shop", category: "food", subcategory: "Coffee" },
  { re: /\bmc\s*donald'?s?\b/i, name: "McDonald's", category: "food" },
  { re: /\b(sukiya|yoshinoya|matsuya|ichiran|coco\s*ichi|saizeriya|mos\s*burger|kfc|burger\s*king|subway|domino'?s|pizza\s*hut)\b/i, name: "", category: "food" },
  { re: /\b(swiggy|zomato)\b/i, name: "", category: "food", subcategory: "Delivery" },

  // Groceries / convenience
  { re: /\bfamily\s*mart\b/i, name: "FamilyMart", category: "groceries" },
  { re: /\b(7\s*-?\s*eleven|seven\s*-?\s*eleven)\b/i, name: "7-Eleven", category: "groceries" },
  { re: /\blawson\b/i, name: "Lawson", category: "groceries" },
  { re: /\b(mini\s*stop|daily\s*yamazaki|new\s*days)\b/i, name: "", category: "groceries" },
  { re: /\b(aeon|seiyu|ito\s*yokado|maruetsu|my\s*basket|gyomu|ok\s*store|summit\s*store|big\s*basket|blinkit|zepto|d\s*mart|reliance\s*fresh)\b/i, name: "", category: "groceries", subcategory: "Supermarket" },

  // Transportation
  { re: /\buber\b/i, name: "Uber", category: "transport", subcategory: "Ride" },
  { re: /\b(ola\s*cabs?|olacabs|rapido|lyft|grab|didi|go\s*taxi)\b/i, name: "", category: "transport", subcategory: "Ride" },
  { re: /\b(jr\s*(east|west|central)|tokyo\s*metro|toei|keio|odakyu|tokyu|irctc|indian\s*railways?|metro\s*rail)\b/i, name: "", category: "transport", subcategory: "Rail" },

  // Subscriptions and entertainment
  { re: /\bnetflix\b/i, name: "Netflix", category: "subscriptions" },
  { re: /\bspotify\b/i, name: "Spotify", category: "subscriptions" },
  { re: /\b(amazon\s*prime|prime\s*video)\b/i, name: "Amazon Prime", category: "subscriptions" },
  { re: /\b(youtube\s*premium|disney\s*\+?|hotstar|apple\.com\/bill|icloud|google\s*one|chatgpt|openai|claude\.ai|anthropic)\b/i, name: "", category: "subscriptions" },
  { re: /\b(toho\s*cinemas?|pvr|inox|book\s*my\s*show|steam|playstation|nintendo)\b/i, name: "", category: "entertainment" },

  // Shopping
  { re: /\bnitori\b/i, name: "Nitori", category: "shopping", subcategory: "Home & Furniture" },
  { re: /\bikea\b/i, name: "IKEA", category: "shopping", subcategory: "Home & Furniture" },
  { re: /\b(muji|francfranc)\b/i, name: "", category: "shopping", subcategory: "Home & Furniture" },
  { re: /\b(amazon|amzn)\b/i, name: "Amazon", category: "shopping", subcategory: "Online" },
  { re: /\b(flipkart|myntra|rakuten|mercari|ajio|meesho)\b/i, name: "", category: "shopping", subcategory: "Online" },
  { re: /\b(uniqlo|gu\s*store|zara|h\s*&\s*m)\b/i, name: "", category: "shopping", subcategory: "Clothing" },
  { re: /\b(yodobashi|bic\s*camera|apple\s*store|croma)\b/i, name: "", category: "shopping", subcategory: "Electronics" },
  { re: /\b(don\s*quijote|donki|daiso|seria|3\s*coins|loft|tokyu\s*hands)\b/i, name: "", category: "shopping" },

  // Bills, travel, health
  { re: /\b(docomo|softbank|kddi|rakuten\s*mobile|airtel|jio|vodafone|tepco|tokyo\s*gas|electricity|broadband)\b/i, name: "", category: "bills" },
  { re: /\b(airbnb|booking\.com|agoda|make\s*my\s*trip|makemytrip|expedia|ana\b|jal\b|indigo|air\s*india|vistara)/i, name: "", category: "travel" },
  { re: /\b(pharmacy|drug\s*store|matsumoto\s*kiyoshi|welcia|sundrug|apollo|clinic|hospital|1mg|pharmeasy)\b/i, name: "", category: "health" },
];

/** Normalised key used for learning rules and duplicate detection. */
export function merchantKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[*#_/\\|]+/g, " ")
    .replace(/\b(PVT|LTD|LIMITED|INC|CO|KK|JP|JAPAN|TOKYO|IN|INDIA)\b\.?/g, " ")
    .replace(/\d{3,}/g, " ")
    .replace(/[^A-Z0-9&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function identifyMerchant(raw: string): MerchantMatch {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  for (const r of RULES) {
    const m = cleaned.match(r.re);
    if (!m) continue;
    const name = r.name || titleCase(m[0].replace(/\s+/g, " "));
    return {
      name,
      key: merchantKey(name),
      category: r.category,
      subcategory: r.subcategory,
      kind: r.kind ?? "expense",
      wallet: r.wallet,
      known: true,
    };
  }
  const key = merchantKey(cleaned);
  return { name: key ? titleCase(key) : "Unknown merchant", key, category: "uncategorised", kind: "expense", known: false };
}
