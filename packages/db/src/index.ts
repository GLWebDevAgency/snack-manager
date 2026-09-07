export * from './schemas';
export * from './invoice-issuance.schema';
export * from './order-capacity.schema';
export * from './delivery-operator.schema';
export * from './media-empreinte';

import mongoose from 'mongoose';

export async function connectDb(uri: string): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri);
}

export { mongoose };
