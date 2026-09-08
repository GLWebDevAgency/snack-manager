import { HttpException } from '@nestjs/common';
import { CustomerIdentityError } from './customer-identity.service';
import { customerHttpError } from '../../common/customer-http-error';
export { customerHttpError } from '../../common/customer-http-error';
export function customerSafeError(error: unknown): HttpException {
  // Never preserve a raw HttpException: a database or adapter may have put
  // parameters in its response/message. Only our fixed vocabulary survives.
  return customerHttpError(error instanceof CustomerIdentityError ? error.reason : 'unavailable');
}
