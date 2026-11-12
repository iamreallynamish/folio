import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSms, splitMessages, SAMPLE_MESSAGES } from "../shared/sms.ts";
import { identifyMerchant } from "../shared/merchants.ts";
import { readFileSync } from "node:fs";
import { toMinor, formatMoney, convertMinor } from "../shared/money.ts";

test("ICICI forex card at NITORI", () => {
  const p = parseSms(SAMPLE_MESSAGES[0]);
  assert.equal(p.class, "transaction");
  assert.equal(p.type, "expense");
  assert.equal(p.amountMinor, 4779);
  assert.equal(p.currency, "JPY");
  assert.equal(p.date, "2026-10-03");
  assert.equal(p.time, undefined);
  assert.equal(p.bank, "ICICI Bank");
  assert.equal(p.instrument, "Forex Prepaid Card");
  assert.equal(p.last4, "0817");
  assert.equal(p.merchant?.name, "Nitori");
  assert.equal(p.merchant?.category, "shopping");
  assert.equal(p.merchant?.subcategory, "Home & Furniture");
  assert.equal(p.balanceMinor, 63756);
  assert.equal(p.balanceCurrency, "JPY");
  assert.equal(p.needsReview, false);
});

test("Axis compact alert: Uber trip", () => {
  const p = parseSms(SAMPLE_MESSAGES[1]);
  assert.equal(p.class, "transaction");
  assert.equal(p.amountMinor, 500);
  assert.equal(p.currency, "JPY");
  assert.equal(p.date, "2026-10-03");
  assert.equal(p.time, "17:03:00");
  assert.equal(p.tz, "IST");
  assert.equal(p.bank, "Axis Bank");
  assert.equal(p.instrument, "Card");
  assert.equal(p.last4, "7117");
  assert.equal(p.merchant?.name, "Uber");
  assert.equal(p.merchant?.category, "transport");
  assert.equal(p.balanceMinor, undefined, "no balance stated, none invented");
});

test("Axis compact alert: FamilyMart", () => {
  const p = parseSms(SAMPLE_MESSAGES[2]);
  assert.equal(p.amountMinor, 421);
  assert.equal(p.date, "2026-10-04");
  assert.equal(p.time, "17:02:40");
  assert.equal(p.merchant?.name, "FamilyMart");
  assert.equal(p.merchant?.category, "groceries");
});

test("Mobile Suica is a stored-value top-up, not a transport expense", () => {
  const p = parseSms(SAMPLE_MESSAGES[3]);
  assert.equal(p.class, "transaction");
  assert.equal(p.type, "transfer");
  assert.equal(p.amountMinor, 4000);
  assert.equal(p.date, "2026-10-05");
  assert.equal(p.time, "20:06:37");
  assert.equal(p.merchant?.kind, "topup");
  assert.equal(p.merchant?.wallet, "Mobile Suica");
  assert.notEqual(p.merchant?.category, "transport");
});

test("merchant dictionary examples", () => {
  assert.equal(identifyMerchant("STARBUCKS COFFEE SHIBUYA").category, "food");
  assert.equal(identifyMerchant("UBER *TRIP").category, "transport");
  assert.equal(identifyMerchant("UBER *EATS").category, "food");
  assert.equal(identifyMerchant("AMAZON.CO.JP").category, "shopping");
  assert.equal(identifyMerchant("AMZN Mktp JP").name, "Amazon");
  assert.equal(identifyMerchant("FAMILYMART").category, "groceries");
  assert.equal(identifyMerchant("FAMILY MART SHINJUKU 123456").name, "FamilyMart");
  assert.equal(identifyMerchant("SOME UNKNOWN SHOP").known, false);
});

test("OTPs, promotions, failures and reminders are ignored", () => {
  assert.equal(parseSms("123456 is your OTP for txn of INR 4,500.00 at AMAZON on card XX7117. Do not share it with anyone.").class, "otp");
  assert.equal(parseSms("Get up to 20% cashback up to Rs.500 on your Axis Bank Card! Offer valid till 31-Oct. T&C apply https://axis.bk/x").class, "promo");
  assert.equal(parseSms("Your transaction of JPY 900 on Axis Bank Card no. XX7117 at LAWSON was declined due to insufficient funds.").class, "failed");
  assert.equal(parseSms("Payment of INR 2,300.00 for your ICICI Bank Credit Card XX0817 is due on 15-Oct-2026.").class, "reminder");
  assert.equal(parseSms("Dear customer, your KYC needs updating.").class, "unknown");
});

test("balance-only notification creates no transaction but carries the balance", () => {
  const p = parseSms("Available balance on your ICICI Bank Forex Prepaid Card XX0817 is JPY 60,000.00 as on 06-Oct-2026.");
  assert.equal(p.class, "balance");
  assert.equal(p.amountMinor, undefined);
  assert.equal(p.balanceMinor, 60000);
  assert.equal(p.last4, "0817");
});

test("refunds and credits", () => {
  const r = parseSms("Refund of INR 499.00 has been credited to your HDFC Bank Credit Card XX4321 from AMAZON on 07-10-26.");
  assert.equal(r.type, "refund");
  assert.equal(r.amountMinor, 49900);
  assert.equal(r.merchant?.name, "Amazon");
  const c = parseSms("Your a/c XX1234 is credited with INR 10,000.00 on 05-10-26 by NEFT from JASSO SCHOLARSHIP. Avl Bal INR 12,345.67");
  assert.equal(c.type, "income");
  assert.equal(c.amountMinor, 1000000);
  assert.equal(c.balanceMinor, 1234567);
});

test("UPI debit that also mentions 'credited to'", () => {
  const p = parseSms("Rs.250.00 debited from A/c XX1234 on 03-10-26 and credited to swiggy@upi (UPI Ref No 627612345678).");
  assert.equal(p.type, "expense");
  assert.equal(p.amountMinor, 25000);
  assert.equal(p.currency, "INR");
  assert.equal(p.date, "2026-10-03");
});

test("message without a date uses the received date and is flagged", () => {
  const p = parseSms("INR 120.00 spent on Axis Bank Card XX7117 at STARBUCKS.", "2026-10-09");
  assert.equal(p.date, "2026-10-09");
  assert.equal(p.dateInferred, true);
  assert.equal(p.needsReview, true);
});

test("splitting pasted text", () => {
  assert.equal(splitMessages(SAMPLE_MESSAGES.join("\n")).length, 4);
  assert.equal(splitMessages("line one\nline two\n\nsecond message").length, 2);
});

test("money maths", () => {
  assert.equal(toMinor("4,779.00", "JPY"), 4779);
  assert.equal(toMinor("12.5", "INR"), 1250);
  assert.equal(toMinor("0.005", "USD"), 1);
  assert.equal(toMinor("abc", "USD"), null);
  assert.equal(formatMoney(63756, "JPY"), "¥63,756");
  assert.equal(formatMoney(-49900, "INR"), "−₹499.00");
  assert.equal(convertMinor(10000, "INR", "JPY", 1.8), 180);
});

// The user's own October 2026 messages, exactly as pasted (line breaks, trailing "0.", cut-off names).
test("real Axis and ICICI alerts: every message is a transaction with the right merchant", () => {
  const msgs = splitMessages(readFileSync(new URL("./fixtures-user-oct26.txt", import.meta.url), "utf8"));
  assert.equal(msgs.length, 20);
  const got = msgs.map((m) => parseSms(m));
  for (const p of got) assert.equal(p.class, "transaction", p.raw);
  const names = got.map((p) => p.merchant?.name ?? null);
  assert.deepEqual(names, [
    "Don Quijote", "Mobile Suica", "7-Eleven", "7-Eleven", null, "Mobile Suica", "7-Eleven", "MaxValu", "7-Eleven", "7-Eleven",
    "FamilyMart", "7-Eleven", "7-Eleven", "7-Eleven", "Ito-Yokado", "Uniqlo", "Ito-Yokado", "McDonald's", "Mobile Suica", "7-Eleven",
  ]);
  // Axis "using … Credit Card no. XX7117 on 24-10-26 21:48:36 IST at SEVEN-ELEVE."
  const axis = got[2];
  assert.equal(axis.amountMinor, 494);
  assert.equal(axis.date, "2026-10-24");
  assert.equal(axis.time, "21:48:36");
  assert.equal(axis.bank, "Axis Bank");
  assert.equal(axis.instrument, "Credit Card");
  assert.equal(axis.last4, "7117");
  assert.equal(axis.merchant?.category, "groceries");
  assert.equal(axis.merchant?.match, "truncated");
  assert.equal(axis.balanceMinor, undefined, "Axis states no balance; none invented");
  // Suica top-ups are money moved into a wallet, not spending.
  assert.equal(got[1].type, "transfer");
  assert.equal(got[1].merchant?.wallet, "Mobile Suica");
  // ICICI "transacted at POS … Bal JPY 86,191.00": a purchase with no shop named — kept, flagged for review.
  assert.equal(got[4].amountMinor, 226);
  assert.equal(got[4].balanceMinor, 86191);
  assert.equal(got[4].needsReview, true);
  // ICICI balance with a stray trailing "0." is read correctly.
  assert.equal(got[6].balanceMinor, 85889);
});

test("misspelled and cut-off merchant names are recognised; lookalikes are not", () => {
  const yes: [string, string][] = [
    ["7-ELEV", "7-Eleven"], ["SEVEN-ELEVE", "7-Eleven"], ["SEVN-ELEVEN", "7-Eleven"], ["MOBILE SUIC", "Mobile Suica"],
    ["7 MOBILE SUIC", "Mobile Suica"], ["MOBILE SUCIA", "Mobile Suica"], ["FAMILYMRT", "FamilyMart"], ["LAWSN", "Lawson"],
    ["DONQUIJOTE", "Don Quijote"], ["MCDONALD S", "McDonald's"], ["STARBUKS", "Starbucks"], ["UNIQLO.CO", "Uniqlo"],
    ["ITOYOKADO", "Ito-Yokado"], ["MAXVALU KOMENOKI", "MaxValu"], ["BICCAMRA", "Bic Camera"], ["UBER* EATS PENDING", "Uber Eats"],
  ];
  for (const [raw, name] of yes) assert.equal(identifyMerchant(raw).name, name, raw);
  for (const raw of ["MOTION GYM", "TOKYO", "SMITH M", "SEVEN", "MOBILE", "STEAMY HOT POT", "LIFESTYLE CO", "GRABBER", "ANAND SWEETS"])
    assert.equal(identifyMerchant(raw).known, false, raw);
});

test("dotted merchant names: AMAZON.CO.JP and WWW.AMAZON.CO.JP are Amazon", () => {
  for (const m of [
    "JPY 2480 using Axis Bank Credit Card no. XX7117 on 02-11-26 10:15:00 IST at WWW.AMAZON.CO.JP",
    "JPY 2,480 using Axis Bank Credit Card no. XX7117 on 02-11-26 10:15:00 IST at \nAMAZON.CO.JP.",
    "JPY 1,299.00 has been made using your ICICI Bank Forex Prepaid Card XX0817 at AMAZON.CO.JP on 02-Nov-2026 . Current available balance on your Forex Prepaid Card is JPY 77,087.00 0.",
    "JPY 899 Axis Bank Card no. XX7117 02-11-26 10:15:00 IST AMAZON.CO.JP",
  ]) {
    const p = parseSms(m);
    assert.equal(p.merchant?.name, "Amazon", m);
    assert.equal(p.merchant?.category, "shopping");
  }
});

test("ATM withdrawals are cash moved to the Cash wallet, not spending", () => {
  for (const m of [
    "JPY 10,000 withdrawn at ATM using ICICI Bank Forex Prepaid Card XX0817 on 03-Nov-2026. Bal JPY 67,087.00",
    "JPY 10000 using Axis Bank Credit Card no. XX7117 on 03-11-26 11:00:00 IST at SEVEN BANK ATM.",
    "JPY 10,000.00 has been made using your ICICI Bank Forex Prepaid Card XX0817 at ATM on 03-Nov-2026 . Current available balance on your Forex Prepaid Card is JPY 67,087.00",
  ]) {
    const p = parseSms(m);
    assert.equal(p.type, "transfer", m);
    assert.equal(p.merchant?.name, "Cash withdrawal");
    assert.equal(p.merchant?.category, "cash");
    assert.equal(p.merchant?.wallet, "Cash");
  }
  // Seven Bank is the ATM network, not 7-Eleven the shop.
  assert.equal(identifyMerchant("SEVEN BANK").name, "Cash withdrawal");
});
