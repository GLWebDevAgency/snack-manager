import { type NextRequest } from "next/server";
import { DeliveryHandoffStateSchema } from "@sm/contracts";
import { invalidMissionRequest, missionApiResponse, missionSession } from "../../../delivery-bff";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = missionSession(request, false);
  if (session.response) return session.response;
  const { id } = await context.params;
  if (!/^[a-f0-9]{24}$/.test(id) || request.nextUrl.pathname !== `/livreur/missions/${id}/handoff`
    || request.nextUrl.searchParams.size || request.nextUrl.hash) return invalidMissionRequest();
  return missionApiResponse(request, { path: `missions/${id}/handoff`, method: "GET", token: session.token,
    schema: DeliveryHandoffStateSchema, matches: state => state.missionId === id && !state.canOverride && !state.canRotate });
}
