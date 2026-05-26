/**
 * ISO 18245 Merchant Category Code → our category slug. Covers ~80% of
 * typical BR consumer credit-card transactions. Codes not listed return
 * null from `categoryForMcc()` and fall through to the LLM tier.
 */
export const MCC_TO_CATEGORY: Record<number, string> = {
  // Groceries
  5411: "groceries",
  5422: "groceries",
  5462: "groceries",
  5499: "groceries",

  // Restaurants & food
  5811: "restaurants",
  5812: "restaurants",
  5813: "restaurants",
  5814: "restaurants",

  // Transport
  4111: "transport",
  4112: "transport",
  4121: "transport",
  4131: "transport",
  4784: "transport",
  4789: "transport",

  // Gas
  5172: "gas",
  5541: "gas",
  5542: "gas",

  // Health
  5912: "health",
  5975: "health",
  8011: "health",
  8021: "health",
  8050: "health",
  8062: "health",
  8099: "health",

  // Utilities (electric, water, gas)
  4900: "utilities",

  // Telecom
  4812: "telecom",
  4814: "telecom",
  4899: "telecom",

  // Shopping (retail)
  5200: "shopping",
  5310: "shopping",
  5311: "shopping",
  5331: "shopping",
  5621: "shopping",
  5651: "shopping",
  5661: "shopping",
  5691: "shopping",
  5712: "shopping",
  5722: "shopping",
  5732: "shopping",
  5942: "shopping",
  5944: "shopping",
  5945: "shopping",
  5947: "shopping",
  5999: "shopping",

  // Subscriptions / digital goods
  5818: "subscriptions",
  5968: "subscriptions",
  5969: "subscriptions",

  // Entertainment
  7832: "entertainment",
  7841: "entertainment",
  7922: "entertainment",
  7929: "entertainment",
  7991: "entertainment",
  7994: "entertainment",
  7997: "entertainment",
  7999: "entertainment",

  // Education
  8211: "education",
  8220: "education",
  8241: "education",
  8244: "education",
  8249: "education",
  8299: "education",

  // Services
  7230: "services",
  7311: "services",
  7321: "services",
  7349: "services",
  7392: "services",
  7399: "services",
  8999: "services",

  // Transfers (cash advance, ATM, money transfer)
  4829: "transfers",
  6010: "transfers",
  6011: "transfers",
  6051: "transfers",

  // Fees / insurance / tax
  6300: "fees",
  6211: "fees",
  9311: "fees",
  9399: "fees",
};
