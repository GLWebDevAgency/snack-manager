import type { NextRequest } from 'next/server';
import { customerAccount, type CustomerContext } from '../customer-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest, context: CustomerContext) {
  return customerAccount(request, context, 'status');
}
