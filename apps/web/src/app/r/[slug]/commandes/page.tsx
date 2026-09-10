import type { Metadata } from "next";
import { generateMetadata as restaurantMetadata } from "../page";

export { default, generateViewport } from "../page";

export async function generateMetadata(
  props: Parameters<typeof restaurantMetadata>[0],
): Promise<Metadata> {
  return {
    ...await restaurantMetadata(props),
    title: "Mes commandes",
    robots: { index: false, follow: true },
  };
}
