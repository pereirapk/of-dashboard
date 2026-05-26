// lib/format/money.ts

export function parseMcpAmountToCents(amount: string): number {
  if (typeof amount !== "string" || amount.length === 0) {
    throw new TypeError(`Invalid money string: ${JSON.stringify(amount)}`);
  }
  if (!/^\d+\.\d{2,4}$/.test(amount)) {
    throw new TypeError(`Invalid money string: ${amount}`);
  }
  const [intPart, fracPart] = amount.split(".");
  let cents: number;
  if (fracPart.length === 2) {
    cents = parseInt(intPart, 10) * 100 + parseInt(fracPart, 10);
  } else if (fracPart.length === 4) {
    const fracInt = parseInt(fracPart, 10);
    const rounded = Math.round(fracInt / 100);
    cents = parseInt(intPart, 10) * 100 + rounded;
  } else if (fracPart.length === 3) {
    const fracInt = parseInt(fracPart, 10);
    const rounded = Math.round(fracInt / 10);
    cents = parseInt(intPart, 10) * 100 + rounded;
  } else {
    throw new TypeError(`Unexpected fractional length in ${amount}`);
  }
  return cents;
}

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function centsToBrl(cents: number): string {
  return BRL_FORMATTER.format(cents / 100);
}
