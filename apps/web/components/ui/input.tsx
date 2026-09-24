import * as React from "react";

import { cn } from "@/lib/utils";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 rounded-md border border-border bg-[#10151d] px-3 text-sm text-foreground outline-none focus:border-primary",
        props.className,
      )}
    />
  );
}
