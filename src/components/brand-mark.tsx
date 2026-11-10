import { cn } from "@/lib/cn";

/** CareerAI's C mark, shared with the favicon and account pages. Decorative: put the name next to it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="64" height="64" rx="14.08" className="fill-primary" />
      <path
        className="stroke-on-primary"
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        d="M44 20a17 17 0 1 0 0 24"
      />
    </svg>
  );
}
