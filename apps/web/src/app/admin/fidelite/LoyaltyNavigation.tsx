"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";
import { LOYALTY_NAVIGATION, isLoyaltyRouteActive } from "./navigation";

export function LoyaltyNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation fidélité"
      className="cf-scroll -mx-4 overflow-x-auto border-b border-line2 px-4 md:-mx-[26px] md:px-[26px]"
    >
      <div className="flex min-w-max gap-1">
        {LOYALTY_NAVIGATION.map((item) => {
          const active = isLoyaltyRouteActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "cf-press relative px-3 py-3 text-[13px] font-bold transition-colors duration-200",
                active ? "text-ink" : "text-mut hover:text-ink",
              )}
            >
              {item.label}
              {active && (
                <span
                  className="absolute inset-x-3 bottom-0 h-0.5 rounded-pill bg-accent"
                  aria-hidden
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
