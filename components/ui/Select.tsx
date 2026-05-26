import { forwardRef } from "react";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", ...rest }, ref) => (
    <select
      ref={ref}
      className={`rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 ${className}`}
      {...rest}
    />
  )
);
Select.displayName = "Select";
