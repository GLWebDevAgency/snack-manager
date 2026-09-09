import { Query, Schema } from 'mongoose';

/** Server-only cross-store identity. No FK to PostgreSQL is implied. */
export const CustomerOrderOwnerSchema = new Schema({
  tenantRef: { type: String, required: true, immutable: true, match: /^[a-f0-9]{24}$/ },
  parentRef: { type: String, required: true, immutable: true, match: /^AC[0-9a-fA-F]{32}$/ },
  accountId: { type: String, required: true, immutable: true, match: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
}, { _id: false, strict: 'throw' });

export function customerOrderOwnerField() {
  return { type: CustomerOrderOwnerSchema, default: null, select: false, immutable: true,
    validate: { validator: function (this: { tenantId?: unknown }, value: { tenantRef: string } | null) {
      const update = this instanceof Query ? this.getUpdate() : null;
      const tenantId = this instanceof Query
        ? (!Array.isArray(update) ? update?.$setOnInsert?.tenantId : undefined) ?? this.get('tenantId')
        : this.tenantId;
      return value === null || String(tenantId) === value.tenantRef;
    }, message: 'Le propriétaire et la commande doivent appartenir au même établissement.' } };
}
