import { CATEGORY_SEEDS } from "@/lib/seed/categories";
import { Icon } from "@/lib/icons";

export interface CategoryMeta {
  slug: string;
  labelPt: string;
  icon: string;
  color: string;
}

const SEED_BY_SLUG = new Map<string, CategoryMeta>(
  CATEGORY_SEEDS.map((c) => [c.slug, c])
);

function resolveCategoryMeta(
  slug: string,
  userCategories?: CategoryMeta[]
): CategoryMeta | undefined {
  if (userCategories) {
    const hit = userCategories.find((c) => c.slug === slug);
    if (hit) return hit;
  }
  return SEED_BY_SLUG.get(slug);
}

export function CategoryBadge({
  slug,
  source,
  userCategories,
}: {
  slug: string | null;
  source: "mcc" | "llm" | "user" | null;
  userCategories?: CategoryMeta[];
}) {
  if (!slug) return <span className="text-xs opacity-50">—</span>;
  const c = resolveCategoryMeta(slug, userCategories);
  if (!c) {
    return <span className="text-xs opacity-50">{slug}</span>;
  }
  const sourceMark =
    source === "user" ? "✱" :
    source === "llm"  ? "·" :
    "";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
      style={{ backgroundColor: `${c.color}22`, color: c.color }}
      title={`${c.labelPt} · ${source ?? "n/a"}`}
    >
      <Icon name={c.icon} size={12} />
      <span>{c.labelPt}</span>
      {sourceMark && <span className="opacity-60">{sourceMark}</span>}
    </span>
  );
}
