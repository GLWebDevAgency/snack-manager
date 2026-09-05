import { describe, expect, it } from 'vitest';
import { StatsService } from './stats.service';

const TENANT = '507f1f77bcf86cd799439011';
const reads: Array<[string, (service: StatsService) => Promise<unknown>]> = [
  ['overview', (s) => s.overview(TENANT, '7d')],
  ['timeseries hour', (s) => s.timeseries(TENANT, '1d')],
  ['timeseries day', (s) => s.timeseries(TENANT, '7d')],
  ['timeseries week', (s) => s.timeseries(TENANT, '30d')],
  ['top products', (s) => s.topProducts(TENANT, '7d', 10)],
  ['channels', (s) => s.channels(TENANT, '7d')],
  ['heatmap', (s) => s.heatmap(TENANT)],
  ['preparation times', (s) => s.prepTimes(TENANT, '7d')],
  ['live summary', (s) => s.summaryLive(TENANT)],
  ['orders export', (s) => s.exportOrdersCsv(TENANT, {})],
];

function build(capabilities: string[]) {
  const filters: Record<string, unknown>[] = [];
  const query = { sort: () => query, limit: () => query, lean: async () => [] };
  const model = {
    aggregate: async (pipeline: Array<{ $match: Record<string, unknown> }>) => {
      filters.push(pipeline[0]!.$match);
      return [];
    },
    countDocuments: async (filter: Record<string, unknown>) => { filters.push(filter); return 0; },
    find: (filter: Record<string, unknown>) => { filters.push(filter); return query; },
  };
  const service = new StatsService(model as never, { countDocuments: async () => 0 } as never,
    {} as never, { countDocuments: async () => 0 } as never, { pourTenant: async () => capabilities } as never);
  return { service, filters };
}

describe('statistics commercial order scope', () => {
  it.each(reads)('limits every order query of %s to the online channel', async (_name, read) => {
    const { service, filters } = build(['online']);
    await read(service);
    expect(filters.length).toBeGreaterThan(0);
    for (const filter of filters) {
      expect(String(filter.tenantId)).toBe(TENANT);
      expect(filter.channel).toBe('online');
    }
  });

  it.each(reads)('refuses %s before reading orders when no order offer is subscribed', async (_name, read) => {
    const { service, filters } = build(['loyalty']);
    await expect(read(service)).rejects.toThrow('non souscrites');
    expect(filters).toHaveLength(0);
  });
});
