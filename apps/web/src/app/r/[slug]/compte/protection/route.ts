import { NextRequest } from 'next/server';
import { customerAccount, type CustomerContext } from '../customer-bff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const POST = (request: NextRequest, context: CustomerContext) => customerAccount(request, context, 'protection');
