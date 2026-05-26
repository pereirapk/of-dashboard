/**
 * Curated icon registry — maps string names (used in DB / seeds / user input)
 * to lucide-react components. Keeping the set explicit means we don't bundle
 * all 1700+ icons.
 */
import {
  ShoppingCart,
  UtensilsCrossed,
  Car,
  Fuel,
  Pill,
  Lightbulb,
  Smartphone,
  ShoppingBag,
  Film,
  Repeat,
  GraduationCap,
  Wrench,
  ArrowLeftRight,
  Scale,
  Coins,
  HelpCircle,
  // sidebar
  LayoutDashboard,
  ArrowDownUp,
  Wallet,
  Settings,
  // common user-category picks
  PawPrint,
  Heart,
  Star,
  Home,
  Plane,
  Book,
  Dumbbell,
  Music,
  Gamepad2,
  Briefcase,
  Gift,
  Baby,
  Dog,
  Cat,
  Coffee,
  type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  // category seeds
  "shopping-cart": ShoppingCart,
  "utensils-crossed": UtensilsCrossed,
  car: Car,
  fuel: Fuel,
  pill: Pill,
  lightbulb: Lightbulb,
  smartphone: Smartphone,
  "shopping-bag": ShoppingBag,
  film: Film,
  repeat: Repeat,
  "graduation-cap": GraduationCap,
  wrench: Wrench,
  "arrow-left-right": ArrowLeftRight,
  scale: Scale,
  coins: Coins,
  "help-circle": HelpCircle,
  // sidebar
  "layout-dashboard": LayoutDashboard,
  "arrow-down-up": ArrowDownUp,
  wallet: Wallet,
  settings: Settings,
  // common user-category picks
  "paw-print": PawPrint,
  heart: Heart,
  star: Star,
  home: Home,
  plane: Plane,
  book: Book,
  dumbbell: Dumbbell,
  music: Music,
  gamepad: Gamepad2,
  briefcase: Briefcase,
  gift: Gift,
  baby: Baby,
  dog: Dog,
  cat: Cat,
  coffee: Coffee,
};

/** All registered icon names — handy for an autocomplete picker. */
export const ICON_NAMES = Object.keys(ICONS).sort();

export type IconProps = {
  name: string;
  size?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
};

/**
 * Render an icon by name. Falls back to HelpCircle if the name is unknown.
 * If the name does not match a registered icon AND looks like a single
 * emoji / short text (<= 4 code points), render it as plain text instead —
 * lets us preserve legacy emoji-string user inputs without breaking the UI.
 */
export function Icon({
  name,
  size = 16,
  className,
  color,
  strokeWidth,
  "aria-hidden": ariaHidden = true,
}: IconProps) {
  const LucideComponent = ICONS[name];
  if (LucideComponent) {
    return (
      <LucideComponent
        size={size}
        className={className}
        color={color}
        strokeWidth={strokeWidth}
        aria-hidden={ariaHidden}
      />
    );
  }
  // Fallback: treat as plain text (likely a legacy emoji).
  if (Array.from(name).length <= 4) {
    return (
      <span
        aria-hidden={ariaHidden}
        className={className}
        style={{ fontSize: size }}
      >
        {name}
      </span>
    );
  }
  // Unknown long string — show a neutral icon.
  return (
    <HelpCircle
      size={size}
      className={className}
      color={color}
      aria-hidden={ariaHidden}
    />
  );
}
