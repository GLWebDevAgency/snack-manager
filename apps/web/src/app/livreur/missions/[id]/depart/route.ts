import { type NextRequest } from "next/server";
import { DeliveryMissionDispatchSchema, DeliveryMissionResultSchema, DeliveryMissionViewSchema, deliveryMissionResultForVersion } from "@sm/contracts";
import { boundedJson, failure, invalidMissionRequest, missionApiResponse, missionSession } from "../../../delivery-bff";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = missionSession(request, true);
  if (session.response) return session.response;
  const params = DeliveryMissionViewSchema.pick({ id: true }).safeParse(await context.params);
  if (!params.success || request.nextUrl.pathname !== `/livreur/missions/${params.data.id}/depart`
    || request.nextUrl.searchParams.size !== 0 || request.nextUrl.hash) return invalidMissionRequest();
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return failure(415, "INVALID_REQUEST", "La demande de départ est invalide.");
  }
  const input = DeliveryMissionDispatchSchema.safeParse(await boundedJson(request));
  if (!input.success) return invalidMissionRequest();
  const id = params.data.id;
  return missionApiResponse(request, { path: `missions/${id}/dispatch`, method: "POST", token: session.token,
    body: input.data, schema: DeliveryMissionResultSchema, forVersion: deliveryMissionResultForVersion,
    matches: result => result.mission.id === id && result.operationId === input.data.operationId });
}
