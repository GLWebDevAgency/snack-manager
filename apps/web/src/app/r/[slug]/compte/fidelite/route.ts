import { NextRequest } from 'next/server';
import { customerAccount, type CustomerContext } from '../customer-bff';
export const dynamic = 'force-dynamic';
export function POST(request: NextRequest, context: CustomerContext) { return customerAccount(request, context, 'loyalty'); }
