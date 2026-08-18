import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

/** Valide le body avec un schéma zod de @sm/contracts : `@Body(zod(CreateOrderSchema))`. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      throw err;
    }
  }
}

export const zod = (schema: ZodType) => new ZodValidationPipe(schema);
