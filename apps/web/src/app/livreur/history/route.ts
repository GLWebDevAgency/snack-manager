import { type NextRequest } from "next/server";
import { DeliveryMissionsQuerySchema, DeliveryHistoryViewSchema } from "@sm/contracts";
import { invalidMissionRequest, missionApiResponse, missionSession, uniqueQuery } from "../delivery-bff";

export async function GET(request: NextRequest) {
  const session = missionSession(request, false);
  if (session.response) return session.response;
  const query = DeliveryMissionsQuerySchema.safeParse(uniqueQuery(request));
  if (!query.success || request.nextUrl.pathname !== "/livreur/history" || request.nextUrl.hash) return invalidMissionRequest();
  const suffix = query.data.after ? `?${new URLSearchParams({ after: query.data.after })}` : "";
  return missionApiResponse(request, { path: `history${suffix}`, method: "GET", token: session.token, schema: DeliveryHistoryViewSchema });
}
