import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as argon2 from 'argon2';
import type { Shift, Staff } from '@sm/db';
import type { ShiftsQuery, StaffCreate, StaffUpdate } from './staff.dto';

/** Arrondi à la demi-heure la plus proche — `round(x×2)/2` (spec backoffice §12.2). */
const roundHalfHours = (ms: number) => Math.round((ms / 3_600_000) * 2) / 2;

/** Lundi 00:00 de la semaine de `d` (heure serveur) — défaut de /staff/shifts. */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // getDay() : dimanche = 0
  return x;
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

@Injectable()
export class StaffService {
  constructor(
    @InjectModel('Staff') private readonly staffModel: Model<Staff>,
    @InjectModel('Shift') private readonly shifts: Model<Shift>,
  ) {}

  /**
   * PIN unique dans le tenant : les PIN sont hashés (argon2), donc
   * vérification séquentielle sur la petite équipe — même approche que le
   * login PIN (auth.service). Inclut les membres désactivés (une
   * réactivation ne doit pas créer de collision).
   */
  private async assertPinFree(tenantId: string, pin: string, exceptId?: string) {
    const members = await this.staffModel.find({ tenantId }).lean();
    for (const m of members) {
      if (exceptId && String(m._id) === exceptId) continue;
      if (await argon2.verify(m.pinHash, pin)) {
        throw new ConflictException('Ce code PIN est déjà utilisé par un autre membre');
      }
    }
  }

  /**
   * Liste de l'équipe + état « en poste maintenant » (shift ouvert) et
   * dernier départ (pour afficher « Parti à HH:MM »). Jamais de pinHash
   * dans les réponses.
   */
  async list(tenantId: string) {
    const [members, open, lastOut] = await Promise.all([
      this.staffModel.find({ tenantId }).sort({ createdAt: 1 }).lean(),
      this.shifts.find({ tenantId, clockOut: null }).sort({ clockIn: -1 }).lean(),
      this.shifts.aggregate<{ _id: Types.ObjectId; clockOut: Date }>([
        { $match: { tenantId: new Types.ObjectId(tenantId), clockOut: { $ne: null } } },
        { $sort: { clockOut: -1 } },
        { $group: { _id: '$staffId', clockOut: { $first: '$clockOut' } } },
      ]),
    ]);

    // Tri clockIn desc → on garde le shift ouvert le plus récent par personne.
    const openByStaff = new Map<string, (typeof open)[number]>();
    for (const s of open) {
      const key = String(s.staffId);
      if (!openByStaff.has(key)) openByStaff.set(key, s);
    }
    const outByStaff = new Map(lastOut.map((s) => [String(s._id), s.clockOut]));

    return members.map(({ pinHash: _pinHash, ...m }) => {
      const shift = openByStaff.get(String(m._id));
      return {
        ...m,
        onDuty: shift ? { shiftId: String(shift._id), clockIn: shift.clockIn } : null,
        lastClockOut: outByStaff.get(String(m._id)) ?? null,
      };
    });
  }

  async create(tenantId: string, dto: StaffCreate) {
    await this.assertPinFree(tenantId, dto.pin);
    const pinHash = await argon2.hash(dto.pin);
    const created = await this.staffModel.create({
      tenantId,
      name: dto.name,
      role: dto.role,
      pinHash,
    });
    const { pinHash: _pinHash, ...member } = created.toObject();
    return { ...member, onDuty: null, lastClockOut: null };
  }

  async update(tenantId: string, id: string, dto: StaffUpdate) {
    const $set: Record<string, unknown> = {};
    for (const k of ['name', 'role', 'active'] as const) {
      if (dto[k] !== undefined) $set[k] = dto[k];
    }
    if (dto.pin !== undefined) {
      await this.assertPinFree(tenantId, dto.pin, id);
      $set.pinHash = await argon2.hash(dto.pin);
    }
    const member = await this.staffModel
      .findOneAndUpdate({ _id: id, tenantId }, { $set }, { new: true })
      .lean();
    if (!member) throw new NotFoundException('Membre introuvable');

    // Désactivation → clôture immédiate d'un éventuel shift ouvert.
    if (dto.active === false) {
      await this.shifts.updateMany(
        { tenantId, staffId: id, clockOut: null },
        { $set: { clockOut: new Date() } },
      );
    }
    const { pinHash: _pinHash, ...rest } = member;
    return rest;
  }

  /** Suppression DOUCE : active=false (l'historique de pointage est conservé). */
  async remove(tenantId: string, id: string) {
    await this.update(tenantId, id, { active: false });
    return { deleted: true };
  }

  /** Badge arrivée/départ depuis le back-office (source 'backoffice'). */
  async clock(tenantId: string, id: string, direction: 'in' | 'out') {
    const member = await this.staffModel.findOne({ _id: id, tenantId }).lean();
    if (!member) throw new NotFoundException('Membre introuvable');
    const now = new Date();

    if (direction === 'in') {
      if (!member.active) {
        throw new ConflictException('Membre désactivé — réactivez-le avant de pointer');
      }
      const open = await this.shifts.findOne({ tenantId, staffId: id, clockOut: null });
      if (open) throw new ConflictException('Déjà en poste — arrivée déjà badgée');
      const shift = await this.shifts.create({
        tenantId,
        staffId: id,
        clockIn: now,
        source: 'backoffice',
      });
      return shift.toObject();
    }

    const open = await this.shifts
      .findOne({ tenantId, staffId: id, clockOut: null })
      .sort({ clockIn: -1 });
    if (!open) throw new ConflictException('Aucun pointage en cours — arrivée non badgée');
    open.clockOut = now;
    await open.save();
    const obj = open.toObject();
    // Heures de la session, arrondies à la demi-heure AU DÉPART (spec §12.2).
    return { ...obj, hours: roundHalfHours(now.getTime() - new Date(obj.clockIn).getTime()) };
  }

  /**
   * Pointages sur une période (défaut : semaine courante lundi→lundi) +
   * total d'heures par personne. L'arrondi 0,5 h s'applique PAR SHIFT clos ;
   * les shifts encore ouverts ont hours=null et ne comptent pas au total.
   */
  async shiftsRange(tenantId: string, query: ShiftsQuery) {
    const from = query.from ?? startOfWeek(new Date());
    const to = query.to ?? addDays(from, 7);

    const [rows, members] = await Promise.all([
      this.shifts
        .find({ tenantId, clockIn: { $gte: from, $lt: to } })
        .sort({ clockIn: 1 })
        .lean(),
      this.staffModel.find({ tenantId }).sort({ createdAt: 1 }).lean(),
    ]);

    const shifts = rows.map((s) => ({
      _id: s._id,
      staffId: s.staffId,
      clockIn: s.clockIn,
      clockOut: s.clockOut ?? null,
      source: s.source,
      hours: s.clockOut
        ? roundHalfHours(new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime())
        : null,
    }));

    const byStaff = new Map<string, number>();
    for (const s of shifts) {
      if (s.hours == null) continue;
      const key = String(s.staffId);
      byStaff.set(key, (byStaff.get(key) ?? 0) + s.hours);
    }

    return {
      from,
      to,
      shifts,
      totals: members.map((m) => ({
        staffId: String(m._id),
        name: m.name,
        role: m.role,
        active: m.active,
        hours: byStaff.get(String(m._id)) ?? 0,
      })),
    };
  }
}
