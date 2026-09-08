import type { NextRequest } from 'next/server';
import { customerAccount, type CustomerContext } from '../customer-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function PATCH(request: NextRequest, context: CustomerContext) {
  return customerAccount(request, context, 'name');
}
