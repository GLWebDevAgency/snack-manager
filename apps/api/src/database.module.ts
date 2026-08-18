import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MODELS } from '@sm/db';

// Tous les modèles de @sm/db, disponibles partout via @InjectModel('<Name>').
const features = MongooseModule.forFeature(
  Object.values(MODELS).map((m) => ({
    name: m.name,
    schema: m.schema,
    collection: m.collection,
  })),
);

@Global()
@Module({
  imports: [features],
  exports: [features],
})
export class DatabaseModule {}
