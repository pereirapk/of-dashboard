import { forwardRef } from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className = "", ...rest }, ref) => {
    const base =
      "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50";
    const styles =
      variant === "primary"
        ? "bg-foreground text-background hover:opacity-90"
        : "border border-foreground/20 bg-transparent hover:bg-foreground/5";
    return <button ref={ref} className={`${base} ${styles} ${className}`} {...rest} />;
  }
);
Button.displayName = "Button";
