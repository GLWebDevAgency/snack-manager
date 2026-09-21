import { ConflictException, Injectable, type PipeTransform } from '@nestjs/common';
import { OrderRefundMutationRequestSchema, type OrderRefundMutationRequest, type OrderRefundRequest } from '@sm/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';

/** Reject old browser code before owner reauthentication or any provider call.
 * The version is a compatibility fence, never a replacement for authorization. */
@Injectable()
export class OrderRefundMutationPipe implements PipeTransform<unknown, OrderRefundRequest> {
  private readonly validation = new ZodValidationPipe(OrderRefundMutationRequestSchema);

  transform(value: unknown): OrderRefundRequest {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || !Object.hasOwn(value, 'clientProtocolVersion')
      || (value as Record<string, unknown>).clientProtocolVersion !== 2) {
      throw new ConflictException({ code: 'REFUND_CLIENT_UPDATE_REQUIRED',
        message: 'Actualisez cette page avant de demander un remboursement.' });
    }
    const { clientProtocolVersion: _clientProtocolVersion, ...business } =
      this.validation.transform(value) as OrderRefundMutationRequest;
    return business;
  }
}
