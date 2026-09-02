import type Redis from 'ioredis';

/**
 * Diffusion auxiliaire après écriture métier : une panne Redis retarde les
 * écrans, elle ne doit ni rejeter la requête déjà réussie ni tuer Node par une
 * promesse fire-and-forget non observée.
 */
export async function publishRedisBestEffort(
  redis: Pick<Redis, 'publish'>,
  channel: string,
  message: string,
): Promise<void> {
  try {
    await redis.publish(channel, message);
  } catch {
    // Les lecteurs disposent du polling/rechargement comme chemin de reprise.
  }
}
