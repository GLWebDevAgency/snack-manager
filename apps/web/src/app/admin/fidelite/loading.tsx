import { Skeleton } from "@/components/ui";

export default function LoyaltyLoading() {
  return (
    <div className="p-4 md:p-[26px]" aria-label="Chargement de la fidélité">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[126px]" />
        ))}
      </div>
      <Skeleton className="mt-4 h-[360px]" />
    </div>
  );
}
