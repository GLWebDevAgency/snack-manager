import { api, ApiError } from "@/lib/api";
import { HandoffHttpError, type HandoffRequest } from "./client";

export const adminHandoffRequest: HandoffRequest = async (path, body) => {
  try {
    const options = { signal: AbortSignal.timeout(12_000) };
    return body ? await api.post<unknown>(path, body, options) : await api.get<unknown>(path, options);
  } catch (cause) {
    if (cause instanceof ApiError) {
      const raw = cause.body;
      throw new HandoffHttpError(cause.status, raw && typeof raw === "object" && "code" in raw && typeof raw.code === "string" ? raw.code : "UNKNOWN");
    }
    throw cause;
  }
};
