export * from './schemas';
export * from './media-empreinte';

import mongoose from 'mongoose';

export async function connectDb(uri: string): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri);
}

export { mongoose };
