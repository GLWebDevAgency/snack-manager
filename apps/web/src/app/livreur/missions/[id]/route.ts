import { type NextRequest } from "next/server";
import { DeliveryMissionViewSchema, deliveryMissionForVersion } from "@sm/contracts";
import { invalidMissionRequest, missionApiResponse, missionSession } from "../../delivery-bff";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = missionSession(request, false);
  if (session.response) return session.response;
  const params = DeliveryMissionViewSchema.pick({ id: true }).safeParse(await context.params);
  if (!params.success || request.nextUrl.pathname !== `/livreur/missions/${params.data.id}`
    || request.nextUrl.searchParams.size !== 0 || request.nextUrl.hash) return invalidMissionRequest();
  const id = params.data.id;
  return missionApiResponse(request, { path: `missions/${id}`, method: "GET", token: session.token,
    schema: DeliveryMissionViewSchema, matches: mission => mission.id === id, forVersion: deliveryMissionForVersion });
}
