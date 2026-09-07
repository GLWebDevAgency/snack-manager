import { Mongoose, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';
import { DeliveryMissionSchema } from './delivery-mission.schema';

const id = new Types.ObjectId('665f0d0a1c2b3d4e5f6a7b01');
const uuid = 'b0b336b8-d64b-4a0e-b3d3-e30aa158ba8d';
const operation = { operationId: uuid, fingerprint: 'a'.repeat(64), action: 'assign', outcome: 'applied', refusalCode: null,
  revision: 1, at: new Date(), actorKind: 'user', actorId: String(id), actorRole: 'owner',
  actorName: null, previousOperatorId: null, operatorId: id, reason: 'Affectation du jour' };
const assignment = { operatorId: id, assignmentId: uuid, operatorName: 'Nora', assignedAt: new Date(), assignedBy: String(id) };
const mission = { version: 1, revision: 1, assignment, operations: [operation] };

describe('preuve de mission embarquée privée', () => {
  it('ne fabrique pas une mission pour l’historique', () => {
    const Order = new Mongoose().model('MissionLegacy', OrderSchema.clone());
    expect(new Order().get('deliveryMission')).toBeNull();
  });
  it('exclut la preuve des sérialisations même sur un document fraîchement créé', () => {
    const Order = new Mongoose().model('MissionPrivacy', OrderSchema.clone());
    const doc = new Order({ deliveryMission: mission });
    expect(doc.get('deliveryMission.revision')).toBe(1);
    expect(doc.toObject()).not.toHaveProperty('deliveryMission');
    expect(doc.toJSON()).not.toHaveProperty('deliveryMission');
    expect(JSON.stringify(doc)).not.toContain('fingerprint');
    expect(OrderSchema.path('deliveryMission').options.select).toBe(false);
  });
  it('borne l’historique sans supprimer silencieusement les opérations anciennes', () => {
    const Mission = new Mongoose().model('MissionBounded', DeliveryMissionSchema.clone());
    const doc = new Mission({ ...mission, operations: Array(129).fill(operation) });
    expect(doc.validateSync()?.errors.operations).toBeDefined();
    expect(doc.operations).toHaveLength(129);
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuse la révision non sûre %s', revision => {
    const Mission = new Mongoose().model('MissionRevision', DeliveryMissionSchema.clone());
    expect(new Mission({ ...mission, revision }).validateSync()?.errors.revision).toBeDefined();
  });
  it('valide le schéma complet et les motifs de refus connus', () => {
    const Mission = new Mongoose().model('MissionValid', DeliveryMissionSchema.clone());
    expect(new Mission(mission).validateSync()).toBeUndefined();
    const doc = new Mission({ ...mission, operations: [{ ...operation, outcome: 'rejected', refusalCode: 'untrusted' }] });
    expect(doc.validateSync()?.errors['operations.0.refusalCode']).toBeDefined();
  });
});
