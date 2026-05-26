export interface CategorySeed {
  slug: string;
  labelPt: string;
  icon: string;          // lucide-react icon name (kebab-case)
  color: string;
  displayOrder: number;
}

export const CATEGORY_SEEDS: CategorySeed[] = [
  { slug: "groceries",     labelPt: "Mercado",            icon: "shopping-cart",    color: "#22c55e", displayOrder: 10 },
  { slug: "restaurants",   labelPt: "Alimentação",        icon: "utensils-crossed", color: "#f97316", displayOrder: 20 },
  { slug: "transport",     labelPt: "Transporte",         icon: "car",              color: "#0ea5e9", displayOrder: 30 },
  { slug: "gas",           labelPt: "Combustível",        icon: "fuel",             color: "#eab308", displayOrder: 40 },
  { slug: "health",        labelPt: "Saúde",              icon: "pill",             color: "#ef4444", displayOrder: 50 },
  { slug: "utilities",     labelPt: "Contas/Utilidades",  icon: "lightbulb",        color: "#a855f7", displayOrder: 60 },
  { slug: "telecom",       labelPt: "Telecom",            icon: "smartphone",       color: "#8b5cf6", displayOrder: 70 },
  { slug: "shopping",      labelPt: "Compras",            icon: "shopping-bag",     color: "#ec4899", displayOrder: 80 },
  { slug: "entertainment", labelPt: "Entretenimento",     icon: "film",             color: "#f59e0b", displayOrder: 90 },
  { slug: "subscriptions", labelPt: "Assinaturas",        icon: "repeat",           color: "#14b8a6", displayOrder: 100 },
  { slug: "education",     labelPt: "Educação",           icon: "graduation-cap",   color: "#3b82f6", displayOrder: 110 },
  { slug: "services",      labelPt: "Serviços",           icon: "wrench",           color: "#64748b", displayOrder: 120 },
  { slug: "transfers",     labelPt: "Transferências",     icon: "arrow-left-right", color: "#94a3b8", displayOrder: 130 },
  { slug: "fees",          labelPt: "Taxas/Encargos",     icon: "scale",            color: "#dc2626", displayOrder: 140 },
  { slug: "income",        labelPt: "Receita",            icon: "coins",            color: "#16a34a", displayOrder: 150 },
  { slug: "other",         labelPt: "Outros",             icon: "help-circle",      color: "#71717a", displayOrder: 999 },
];

export const CATEGORY_SLUGS: Set<string> = new Set(CATEGORY_SEEDS.map((c) => c.slug));
