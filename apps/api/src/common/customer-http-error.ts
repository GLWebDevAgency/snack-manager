import { HttpException } from '@nestjs/common';

const errors = {
  unavailable: [503, 'CUSTOMER_UNAVAILABLE', 'Service de compte momentanément indisponible.'],
  invalid_request: [400, 'CUSTOMER_INVALID_REQUEST', 'Demande de compte invalide.'],
  unauthorized: [401, 'CUSTOMER_UNAUTHORIZED', 'Accès au compte invalide ou expiré.'],
  conflict: [409, 'CUSTOMER_CONFLICT', 'Le profil a changé. Actualisez-le avant de réessayer.'],
  limited: [429, 'CUSTOMER_RATE_LIMITED', 'Trop de demandes. Réessayez plus tard.'],
  relay: [403, 'CUSTOMER_RELAY_REFUSED', 'Accès au compte indisponible.'],
} as const;

export function customerHttpError(reason: keyof typeof errors): HttpException {
  const [status, code, message] = errors[reason];
  return new HttpException({ code, message }, status);
}

/** HTTP parsing occurs before controller guards. Use this fixed vocabulary
 * before returning OR recording an error on the personal-account boundary. */
export function customerBoundaryError(exception: unknown): HttpException {
  const status = exception instanceof HttpException ? exception.getStatus()
    : typeof exception === 'object' && exception !== null && 'status' in exception ? exception.status : undefined;
  switch (status) {
    case 400: return customerHttpError('invalid_request');
    case 401: return customerHttpError('unauthorized');
    case 403: return customerHttpError('relay');
    case 409: return customerHttpError('conflict');
    case 429: return customerHttpError('limited');
    case 404: case 405: case 413: case 415:
      return new HttpException(customerHttpError('invalid_request').getResponse(), status);
    default: return customerHttpError('unavailable');
  }
}
