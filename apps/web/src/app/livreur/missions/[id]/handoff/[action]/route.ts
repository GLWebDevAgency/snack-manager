import { type NextRequest } from "next/server";
import { DeliveryHandoffIncidentSchema, DeliveryHandoffResolveSchema, DeliveryHandoffResultSchema, DeliveryHandoffSubmitSchema } from "@sm/contracts";
import { boundedJson, failure, invalidMissionRequest, missionApiResponse, missionSession } from "../../../../delivery-bff";

/** This BFF never exposes override/rotation, even if callers invent a route or body. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; action: string }> }) {
  const session = missionSession(request, true);
  if (session.response) return session.response;
  const { id, action } = await context.params;
  if (!/^[a-f0-9]{24}$/.test(id) || !["confirm", "incident", "resolve"].includes(action)
    || request.nextUrl.pathname !== `/livreur/missions/${id}/handoff/${action}`
    || request.nextUrl.searchParams.size || request.nextUrl.hash) return invalidMissionRequest();
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return failure(415, "INVALID_REQUEST", "La demande de remise est invalide.");
  }
  const schema = action === "confirm" ? DeliveryHandoffSubmitSchema : action === "incident" ? DeliveryHandoffIncidentSchema : DeliveryHandoffResolveSchema;
  const input = schema.safeParse(await boundedJson(request));
  if (!input.success || ("action" in input.data && !["handoff", "incident"].includes(input.data.action))) return invalidMissionRequest();
  const expectedAction = action === "confirm" ? "handoff" : action === "incident" ? "incident" : (input.data as { action: string }).action;
  return missionApiResponse(request, { path: `missions/${id}/handoff/${action}`, method: "POST", token: session.token,
    body: input.data, schema: DeliveryHandoffResultSchema,
    matches: result => result.missionId === id && result.state.missionId === id
      && result.operationId === input.data.operationId && result.action === expectedAction
      && result.appliedRevision > input.data.expectedRevision && result.state.revision >= result.appliedRevision
      && !result.state.canOverride && !result.state.canRotate });
}
