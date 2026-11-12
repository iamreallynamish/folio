/**
 * Merchant dictionary: maps raw card descriptors to a canonical merchant, a category and a kind.
 * `kind: "topup"` marks stored-value wallets — money moved, not yet spent.
 *
 * Bank alerts rarely spell merchants cleanly. The same 7-Eleven arrives as "SEVEN-ELEVEN",
 * "SEVEN-ELEVE" (cut at the bank's character limit), "7-ELEVEN" or with a stray typo; Mobile Suica as
 * "MOBILE SUIC"; Don Quijote as "DONQUIJOTE"; McDonald's as "MCDONALD S". So matching works on
 * letters and digits only, and accepts, in order of confidence:
 *   1. the name inside the descriptor ("UNIQLO.CO" → Uniqlo, "MAXVALU KOMENOKI" → MaxValu);
 *   2. a descriptor cut short ("SEVEN-ELEVE" → 7-Eleven), when enough of the name is there;
 *   3. a small typo (one letter wrong in a short name, two in a long one).
 * A correction the user makes always wins over this (merchant_rules, see services/ingest).
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
  /** How the name was recognised: exact text, a cut-off descriptor, or a near spelling. */
  match?: "exact" | "truncated" | "fuzzy";
}

interface Entry { name: string; aliases: string[]; category: string; subcategory?: string; kind?: "topup" | "transfer"; wallet?: string }

/** Shorthand: name, aliases (spelling variants the bank may use), category, subcategory. */
const E = (name: string, aliases: string[], category: string, subcategory?: string): Entry => ({ name, aliases, category, subcategory });
const W = (name: string, aliases: string[]): Entry => ({ name, aliases, category: "topup", kind: "topup", wallet: name });

/** Cash from an ATM: money moved from the card into your Cash wallet, not spent (spend it as separate expenses). */
const CASH: Entry = { name: "Cash withdrawal", aliases: ["ATM", "CASH WITHDRAWAL", "CASH WDL", "SEVEN BANK", "AEON BANK", "YUCHO", "JP BANK", "E NET", "ENET ATM", "LAWSON BANK"], category: "cash", kind: "transfer", wallet: "Cash" };

const ENTRIES: Entry[] = [
  CASH,
  // Stored-value wallets and transit cards: money moved, not yet spent
  W("Mobile Suica", ["MOBILE SUICA", "SUICA", "MOBILESUICA"]),
  W("PASMO", ["PASMO", "MOBILE PASMO"]),
  W("ICOCA", ["ICOCA"]),
  W("PayPay", ["PAYPAY"]),
  W("nanaco", ["NANACO"]),
  W("Rakuten Edy", ["RAKUTEN EDY", "EDY"]),
  W("Paytm Wallet", ["PAYTM WALLET", "PAYTM ADD MONEY"]),

  // Food & beverage
  E("Uber Eats", ["UBER EATS", "UBEREATS"], "food", "Delivery"),
  E("Demae-can", ["DEMAECAN", "DEMAE CAN"], "food", "Delivery"),
  E("Wolt", ["WOLT"], "food", "Delivery"),
  E("Swiggy", ["SWIGGY"], "food", "Delivery"),
  E("Zomato", ["ZOMATO"], "food", "Delivery"),
  E("Starbucks", ["STARBUCKS"], "food", "Coffee"),
  E("Doutor", ["DOUTOR"], "food", "Coffee"),
  E("Tully's Coffee", ["TULLYS"], "food", "Coffee"),
  E("Komeda Coffee", ["KOMEDA"], "food", "Coffee"),
  E("Blue Bottle Coffee", ["BLUE BOTTLE"], "food", "Coffee"),
  E("Excelsior Caffé", ["EXCELSIOR"], "food", "Coffee"),
  E("Pronto", ["PRONTO"], "food", "Coffee"),
  E("Saint Marc Café", ["SAINT MARC", "ST MARC"], "food", "Coffee"),
  E("Mister Donut", ["MISTER DONUT", "MISDO"], "food", "Coffee"),
  E("McDonald's", ["MCDONALDS", "MCDONALD", "MACDONALDS", "MC DONALDS"], "food", "Fast food"),
  E("Burger King", ["BURGER KING"], "food", "Fast food"),
  E("KFC", ["KFC", "KENTUCKY FRIED CHICKEN"], "food", "Fast food"),
  E("Mos Burger", ["MOS BURGER", "MOSBURGER"], "food", "Fast food"),
  E("Lotteria", ["LOTTERIA"], "food", "Fast food"),
  E("Freshness Burger", ["FRESHNESS BURGER"], "food", "Fast food"),
  E("Subway", ["SUBWAY"], "food", "Fast food"),
  E("Domino's", ["DOMINOS", "DOMINO S"], "food", "Fast food"),
  E("Pizza Hut", ["PIZZA HUT"], "food", "Fast food"),
  E("Sukiya", ["SUKIYA"], "food", "Restaurant"),
  E("Yoshinoya", ["YOSHINOYA"], "food", "Restaurant"),
  E("Matsuya", ["MATSUYA"], "food", "Restaurant"),
  E("Ichiran", ["ICHIRAN"], "food", "Restaurant"),
  E("CoCo Ichibanya", ["COCO ICHIBANYA", "COCOICHI", "COCO ICHI"], "food", "Restaurant"),
  E("Saizeriya", ["SAIZERIYA"], "food", "Restaurant"),
  E("Gusto", ["GUSTO"], "food", "Restaurant"),
  E("Sushiro", ["SUSHIRO", "AKINDO SUSHIRO"], "food", "Restaurant"),
  E("Kura Sushi", ["KURA SUSHI", "KURAZUSHI"], "food", "Restaurant"),
  E("Hama Sushi", ["HAMA SUSHI", "HAMAZUSHI"], "food", "Restaurant"),
  E("Tenya", ["TENYA"], "food", "Restaurant"),
  E("Hidakaya", ["HIDAKAYA"], "food", "Restaurant"),
  E("Gyukaku", ["GYUKAKU"], "food", "Restaurant"),
  E("Marugame Seimen", ["MARUGAME SEIMEN", "MARUGAME"], "food", "Restaurant"),
  E("Ootoya", ["OOTOYA"], "food", "Restaurant"),
  E("Yayoiken", ["YAYOIKEN"], "food", "Restaurant"),
  E("Ringer Hut", ["RINGER HUT"], "food", "Restaurant"),
  E("Bikkuri Donkey", ["BIKKURI DONKEY"], "food", "Restaurant"),
  E("Krispy Kreme", ["KRISPY KREME"], "food", "Coffee"),

  // Groceries and convenience stores
  E("7-Eleven", ["SEVEN ELEVEN", "7 ELEVEN", "SEVENELEVEN", "7ELEVEN", "SEVEN ELEVEN JAPAN"], "groceries"),
  E("FamilyMart", ["FAMILYMART", "FAMILY MART", "FAMIMA"], "groceries"),
  E("Lawson", ["LAWSON", "NATURAL LAWSON", "LAWSON STORE"], "groceries"),
  E("Ministop", ["MINISTOP", "MINI STOP"], "groceries"),
  E("Daily Yamazaki", ["DAILY YAMAZAKI"], "groceries"),
  E("NewDays", ["NEWDAYS", "NEW DAYS"], "groceries"),
  E("Seicomart", ["SEICOMART", "SEICO MART"], "groceries"),
  E("MaxValu", ["MAXVALU", "MAX VALU"], "groceries", "Supermarket"),
  E("Aeon", ["AEON", "AEON STYLE"], "groceries", "Supermarket"),
  E("Ito-Yokado", ["ITOYOKADO", "ITO YOKADO"], "groceries", "Supermarket"),
  E("York Mart", ["YORK MART", "YORKMART"], "groceries", "Supermarket"),
  E("Seiyu", ["SEIYU"], "groceries", "Supermarket"),
  E("Maruetsu", ["MARUETSU"], "groceries", "Supermarket"),
  E("My Basket", ["MY BASKET", "MYBASKET"], "groceries", "Supermarket"),
  E("Gyomu Super", ["GYOMU SUPER", "GYOMU"], "groceries", "Supermarket"),
  E("OK Store", ["OK STORE"], "groceries", "Supermarket"),
  E("Summit", ["SUMMIT STORE"], "groceries", "Supermarket"),
  E("Life", ["LIFE SUPERMARKET", "LIFE CORPORATION"], "groceries", "Supermarket"),
  E("Tokyu Store", ["TOKYU STORE"], "groceries", "Supermarket"),
  E("Seijo Ishii", ["SEIJO ISHII", "SEIJOISHII"], "groceries", "Supermarket"),
  E("Kaldi Coffee Farm", ["KALDI"], "groceries", "Supermarket"),
  E("Hanamasa", ["HANAMASA"], "groceries", "Supermarket"),
  E("Inageya", ["INAGEYA"], "groceries", "Supermarket"),
  E("Co-op", ["COOP", "CO OP"], "groceries", "Supermarket"),
  E("Big Basket", ["BIGBASKET", "BIG BASKET"], "groceries", "Supermarket"),
  E("Blinkit", ["BLINKIT"], "groceries", "Supermarket"),
  E("Zepto", ["ZEPTO"], "groceries", "Supermarket"),
  E("DMart", ["DMART", "D MART", "AVENUE SUPERMARTS"], "groceries", "Supermarket"),
  E("Reliance Fresh", ["RELIANCE FRESH", "RELIANCE SMART"], "groceries", "Supermarket"),

  // Transportation
  E("Uber", ["UBER", "UBER TRIP"], "transport", "Ride"),
  E("GO Taxi", ["GO TAXI", "GOTAXI"], "transport", "Ride"),
  E("DiDi", ["DIDI"], "transport", "Ride"),
  E("Ola", ["OLA CABS", "OLACABS"], "transport", "Ride"),
  E("Rapido", ["RAPIDO"], "transport", "Ride"),
  E("Grab", ["GRAB"], "transport", "Ride"),
  E("Lyft", ["LYFT"], "transport", "Ride"),
  E("JR East", ["JR EAST", "JREAST", "EAST JAPAN RAILWAY"], "transport", "Rail"),
  E("JR Central", ["JR CENTRAL", "SMART EX", "SMARTEX"], "transport", "Rail"),
  E("JR West", ["JR WEST", "JRWEST"], "transport", "Rail"),
  E("Tokyo Metro", ["TOKYO METRO", "TOKYOMETRO"], "transport", "Rail"),
  E("Toei", ["TOEI"], "transport", "Rail"),
  E("Keio", ["KEIO"], "transport", "Rail"),
  E("Odakyu", ["ODAKYU"], "transport", "Rail"),
  E("Tokyu", ["TOKYU", "TOKYU RAILWAYS"], "transport", "Rail"),
  E("Seibu", ["SEIBU"], "transport", "Rail"),
  E("Tobu", ["TOBU"], "transport", "Rail"),
  E("Keikyu", ["KEIKYU"], "transport", "Rail"),
  E("Keisei", ["KEISEI"], "transport", "Rail"),
  E("IRCTC", ["IRCTC", "INDIAN RAILWAYS"], "transport", "Rail"),
  E("Times Car", ["TIMES CAR", "TIMES PARKING"], "transport", "Car"),
  E("ENEOS", ["ENEOS"], "transport", "Fuel"),

  // Subscriptions
  E("Netflix", ["NETFLIX"], "subscriptions"),
  E("Spotify", ["SPOTIFY"], "subscriptions"),
  E("Amazon Prime", ["AMAZON PRIME", "PRIME VIDEO", "AMZN PRIME"], "subscriptions"),
  E("YouTube Premium", ["YOUTUBE PREMIUM", "YOUTUBEPREMIUM", "GOOGLE YOUTUBE"], "subscriptions"),
  E("Disney+", ["DISNEY PLUS", "DISNEYPLUS"], "subscriptions"),
  E("Apple", ["APPLE COM BILL", "APPLECOMBILL", "ITUNES"], "subscriptions"),
  E("iCloud", ["ICLOUD"], "subscriptions"),
  E("Google One", ["GOOGLE ONE"], "subscriptions"),
  E("Google Play", ["GOOGLE PLAY"], "subscriptions"),
  E("ChatGPT", ["CHATGPT", "OPENAI"], "subscriptions"),
  E("Claude", ["CLAUDE AI", "ANTHROPIC"], "subscriptions"),
  E("Hotstar", ["HOTSTAR"], "subscriptions"),
  E("Adobe", ["ADOBE"], "subscriptions"),
  E("Microsoft", ["MICROSOFT", "MSFT"], "subscriptions"),
  E("Notion", ["NOTION"], "subscriptions"),
  E("Duolingo", ["DUOLINGO"], "subscriptions"),
  E("Canva", ["CANVA"], "subscriptions"),

  // Entertainment
  E("Toho Cinemas", ["TOHO CINEMAS", "TOHOCINEMAS"], "entertainment", "Cinema"),
  E("Aeon Cinema", ["AEON CINEMA"], "entertainment", "Cinema"),
  E("PVR", ["PVR"], "entertainment", "Cinema"),
  E("INOX", ["INOX"], "entertainment", "Cinema"),
  E("BookMyShow", ["BOOKMYSHOW", "BOOK MY SHOW"], "entertainment"),
  E("Steam", ["STEAM", "STEAMPOWERED"], "entertainment", "Games"),
  E("PlayStation", ["PLAYSTATION"], "entertainment", "Games"),
  E("Nintendo", ["NINTENDO"], "entertainment", "Games"),
  E("Round1", ["ROUND1", "ROUND ONE"], "entertainment"),
  E("Karaoke", ["KARAOKE", "BIG ECHO", "KARAOKEKAN"], "entertainment"),
  E("Tokyo Disney Resort", ["TOKYO DISNEY"], "entertainment"),

  // Shopping
  E("Don Quijote", ["DONQUIJOTE", "DON QUIJOTE", "DONKI", "DONKIHOTE", "MEGA DONQUIJOTE"], "shopping", "General store"),
  E("Daiso", ["DAISO"], "shopping", "General store"),
  E("Seria", ["SERIA"], "shopping", "General store"),
  E("3COINS", ["3COINS", "3 COINS"], "shopping", "General store"),
  E("Loft", ["LOFT"], "shopping", "General store"),
  E("Tokyu Hands", ["TOKYU HANDS", "HANDS"], "shopping", "General store"),
  E("Nitori", ["NITORI"], "shopping", "Home & Furniture"),
  E("IKEA", ["IKEA"], "shopping", "Home & Furniture"),
  E("Muji", ["MUJI", "MUJIRUSHI"], "shopping", "Home & Furniture"),
  E("Francfranc", ["FRANCFRANC"], "shopping", "Home & Furniture"),
  E("Uniqlo", ["UNIQLO"], "shopping", "Clothing"),
  E("GU", ["GU"], "shopping", "Clothing"),
  E("Zara", ["ZARA"], "shopping", "Clothing"),
  E("H&M", ["H M", "HENNES"], "shopping", "Clothing"),
  E("ABC-Mart", ["ABC MART", "ABCMART"], "shopping", "Clothing"),
  E("Shimamura", ["SHIMAMURA"], "shopping", "Clothing"),
  E("Workman", ["WORKMAN"], "shopping", "Clothing"),
  E("Yodobashi Camera", ["YODOBASHI"], "shopping", "Electronics"),
  E("Bic Camera", ["BIC CAMERA", "BICCAMERA"], "shopping", "Electronics"),
  E("Yamada Denki", ["YAMADA DENKI", "YAMADADENKI"], "shopping", "Electronics"),
  E("Edion", ["EDION"], "shopping", "Electronics"),
  E("Apple Store", ["APPLE STORE"], "shopping", "Electronics"),
  E("Croma", ["CROMA"], "shopping", "Electronics"),
  E("Book Off", ["BOOKOFF", "BOOK OFF"], "shopping", "Books"),
  E("Kinokuniya", ["KINOKUNIYA"], "shopping", "Books"),
  E("Tsutaya", ["TSUTAYA"], "shopping", "Books"),
  E("Animate", ["ANIMATE"], "shopping"),
  E("Amazon", ["AMAZON", "AMZN"], "shopping", "Online"),
  E("Rakuten", ["RAKUTEN"], "shopping", "Online"),
  E("Mercari", ["MERCARI"], "shopping", "Online"),
  E("Shein", ["SHEIN"], "shopping", "Online"),
  E("Temu", ["TEMU"], "shopping", "Online"),
  E("Flipkart", ["FLIPKART"], "shopping", "Online"),
  E("Myntra", ["MYNTRA"], "shopping", "Online"),
  E("Ajio", ["AJIO"], "shopping", "Online"),
  E("Meesho", ["MEESHO"], "shopping", "Online"),
  E("Nykaa", ["NYKAA"], "shopping", "Online"),

  // Bills and utilities
  E("docomo", ["DOCOMO", "NTT DOCOMO", "AHAMO"], "bills", "Phone"),
  E("SoftBank", ["SOFTBANK", "LINEMO"], "bills", "Phone"),
  E("au", ["KDDI", "POVO"], "bills", "Phone"),
  E("Rakuten Mobile", ["RAKUTEN MOBILE"], "bills", "Phone"),
  E("Airtel", ["AIRTEL"], "bills", "Phone"),
  E("Jio", ["JIO", "RELIANCE JIO"], "bills", "Phone"),
  E("Vi", ["VODAFONE", "VODAFONE IDEA"], "bills", "Phone"),
  E("TEPCO", ["TEPCO", "TOKYO DENRYOKU"], "bills", "Electricity"),
  E("Tokyo Gas", ["TOKYO GAS"], "bills", "Gas"),

  // Travel
  E("Airbnb", ["AIRBNB"], "travel", "Stay"),
  E("Booking.com", ["BOOKING COM", "BOOKINGCOM"], "travel", "Stay"),
  E("Agoda", ["AGODA"], "travel", "Stay"),
  E("Expedia", ["EXPEDIA"], "travel", "Stay"),
  E("Toyoko Inn", ["TOYOKO INN"], "travel", "Stay"),
  E("APA Hotel", ["APA HOTEL"], "travel", "Stay"),
  E("Klook", ["KLOOK"], "travel"),
  E("MakeMyTrip", ["MAKEMYTRIP", "MAKE MY TRIP"], "travel"),
  E("ANA", ["ANA", "ALL NIPPON"], "travel", "Flights"),
  E("JAL", ["JAL", "JAPAN AIRLINES"], "travel", "Flights"),
  E("Peach", ["PEACH AVIATION"], "travel", "Flights"),
  E("Jetstar", ["JETSTAR"], "travel", "Flights"),
  E("IndiGo", ["INDIGO", "INTERGLOBE"], "travel", "Flights"),
  E("Air India", ["AIR INDIA"], "travel", "Flights"),

  // Health
  E("Matsumoto Kiyoshi", ["MATSUMOTO KIYOSHI", "MATSUKIYO"], "health", "Pharmacy"),
  E("Welcia", ["WELCIA"], "health", "Pharmacy"),
  E("Sundrug", ["SUNDRUG", "SUN DRUG"], "health", "Pharmacy"),
  E("Sugi Pharmacy", ["SUGI DRUG", "SUGI YAKKYOKU", "SUGI PHARMACY"], "health", "Pharmacy"),
  E("Tsuruha", ["TSURUHA"], "health", "Pharmacy"),
  E("Cocokara Fine", ["COCOKARA"], "health", "Pharmacy"),
  E("Daikoku Drug", ["DAIKOKU DRUG"], "health", "Pharmacy"),
  E("Apollo Pharmacy", ["APOLLO PHARMACY"], "health", "Pharmacy"),
  E("Tata 1mg", ["1MG"], "health", "Pharmacy"),
  E("PharmEasy", ["PHARMEASY"], "health", "Pharmacy"),

  // Education
  E("Coursera", ["COURSERA"], "education"),
  E("Udemy", ["UDEMY"], "education"),
];

/** Patterns the alias table can't express (wording rather than a name). Checked first. */
const PATTERNS: { re: RegExp; entry: Entry }[] = [
  { re: /\b(atm|cash)\s*(wdl|withdrawal|w\/d)\b|\batm\b.*\bwithdr|\bwithdr[a-z]*\b.*\batm\b/i, entry: CASH },
  { re: /\bamazon\s*pay\s*(balance|add|top)/i, entry: W("Amazon Pay balance", []) },
  { re: /\bapple\.com\/bill\b/i, entry: E("Apple", [], "subscriptions") },
  { re: /\b(pharmacy|drug\s*store|clinic|hospital|dental)\b/i, entry: E("", [], "health", "Pharmacy") },
  { re: /\b(electricity|broadband|water\s*bill)\b/i, entry: E("", [], "bills") },
];

/** Letters and digits only, upper case: "Seven-Eleve." → "SEVENELEVE". */
const squash = (s: string) => s.toUpperCase().replace(/&/g, "").replace(/[^A-Z0-9]+/g, "");
const tokensOf = (s: string) => s.toUpperCase().replace(/'/g, "").split(/[^A-Z0-9]+/).filter(Boolean);

/** Optimal string alignment distance (Levenshtein plus swapped neighbours), early exit past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

/** Typos tolerated for a name of this length: none up to five letters (TOKYO is not TOKYU), where one letter changes the word. */
const allowedTypos = (len: number) => (len >= 10 ? 2 : len >= 6 ? 1 : 0);

interface Candidate { entry: Entry; how: "exact" | "truncated" | "fuzzy"; score: number }

/** Best dictionary match for a descriptor, or undefined. Exported for tests. */
export function matchMerchant(raw: string): Candidate | undefined {
  const tokens = tokensOf(raw);
  if (!tokens.length) return undefined;
  const whole = tokens.join("");
  const tokenSet = new Set(tokens);
  let best: Candidate | undefined;
  const consider = (c: Candidate) => { if (!best || c.score > best.score) best = c; };
  // Where each word starts and ends inside the squashed descriptor.
  const starts = new Set<number>(), ends = new Set<number>();
  let at = 0;
  for (const t of tokens) { starts.add(at); at += t.length; ends.add(at); }

  for (const entry of ENTRIES) {
    for (const alias of entry.aliases) {
      const a = squash(alias);
      if (!a) continue;
      // Short names (GU, JAL, KFC, UBER) only as a whole word, never inside another word.
      if (a.length <= 4) {
        const words = tokensOf(alias);
        const hit = words.length === 1 ? tokenSet.has(a) : ` ${tokens.join(" ")} `.includes(` ${words.join(" ")} `);
        if (hit) consider({ entry, how: "exact", score: 300 + a.length });
        continue;
      }
      // The name inside the descriptor, starting at a word ("UNIQLO.CO", "MAXVALU KOMENOKI", "MCDONALD S").
      // A short name must also end at a word, so "STEAMY HOT POT" isn't Steam.
      let found = false;
      for (let i = whole.indexOf(a); i >= 0; i = whole.indexOf(a, i + 1)) {
        if (starts.has(i) && (a.length >= 6 || ends.has(i + a.length))) { found = true; break; }
      }
      if (found) { consider({ entry, how: "exact", score: 300 + a.length }); continue; }

      // Try from each word: the descriptor may carry a prefix ("7 MOBILE SUIC", "MEGA DONQUIJOTE").
      const typos = allowedTypos(a.length);
      for (let i = 0; i < tokens.length && i < 4; i++) {
        const s = tokens.slice(i).join("");
        // Most of the name must be there (more of it when it starts mid-descriptor), so "TOKYO" alone
        // isn't Tokyo Gas and "MOBILE" alone isn't Mobile Suica.
        const enough = Math.max(5, Math.ceil(a.length * (i ? 0.8 : 0.7)));
        // Cut off by the bank's length limit: "SEVENELEVE" is the start of "SEVENELEVEN".
        if (s.length < a.length && s.length >= enough && a.startsWith(s)) {
          consider({ entry, how: "truncated", score: 200 + s.length });
          break;
        }
        // A near spelling (typos rarely hit the first letter, which keeps MOTION from becoming Notion).
        if (!typos || s[0] !== a[0]) continue;
        // Word ends within s, so a short name is compared with whole words, not the start of a longer one.
        const wordEnds = new Set<number>(); let e = 0;
        for (const t of tokens.slice(i)) { e += t.length; wordEnds.add(e); }
        const pieces = s.length >= a.length
          ? [a.length, a.length - 1, a.length + 1].filter((n) => a.length >= 7 || wordEnds.has(n)).map((n) => [s.slice(0, n), a])
          : [[s, a], ...(s.length >= enough ? [[s, a.slice(0, s.length)]] : [])];
        let d = typos + 1;
        for (const [x, y] of pieces) if (x.length >= 5) d = Math.min(d, editDistance(x, y, typos));
        if (d <= typos) { consider({ entry, how: "fuzzy", score: 100 + a.length - d * 3 }); break; }
      }
    }
  }
  return best;
}

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

function result(entry: Entry, fallbackName: string, how: MerchantMatch["match"]): MerchantMatch {
  const name = entry.name || fallbackName;
  return { name, key: merchantKey(name), category: entry.category, subcategory: entry.subcategory, kind: entry.kind ?? "expense", wallet: entry.wallet, known: true, match: how };
}

export function identifyMerchant(raw: string): MerchantMatch {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  for (const p of PATTERNS) {
    const m = cleaned.match(p.re);
    if (m) return result(p.entry, titleCase(cleaned), "exact");
  }
  const c = matchMerchant(cleaned);
  if (c) return result(c.entry, titleCase(cleaned), c.how);
  const key = merchantKey(cleaned);
  return { name: key ? titleCase(key) : "Unknown merchant", key, category: "uncategorised", kind: "expense", known: false };
}
