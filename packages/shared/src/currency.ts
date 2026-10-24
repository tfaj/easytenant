export const SUPPORTED_CURRENCIES = ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_META: Record<CurrencyCode, { label: string; symbol: string; locale: string }> = {
  NGN: { label: "Nigerian naira", symbol: "₦", locale: "en-NG" },
  USD: { label: "US dollar", symbol: "$", locale: "en-US" },
  GBP: { label: "British pound", symbol: "£", locale: "en-GB" },
  EUR: { label: "Euro", symbol: "€", locale: "en-IE" },
  GHS: { label: "Ghanaian cedi", symbol: "GH₵", locale: "en-GH" },
  KES: { label: "Kenyan shilling", symbol: "KSh", locale: "en-KE" },
  ZAR: { label: "South African rand", symbol: "R", locale: "en-ZA" },
};

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function formatMoney(amount: number | null | undefined, code: string | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const currency = isCurrencyCode(code) ? code : "NGN";
  try {
    return new Intl.NumberFormat(CURRENCY_META[currency].locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${CURRENCY_META[currency].symbol}${amount.toLocaleString()}`;
  }
}
