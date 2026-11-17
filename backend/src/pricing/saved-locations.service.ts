import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../infra/prisma/prisma.service';

/**
 * SAVED LOCATIONS — the pickup and drop-off points the platform keeps on hand.
 *
 * The booking form offers these before anyone types an address, because in Benin
 * City the places people name are often not in any map database ("Ikpoba Hill"
 * simply is not in OpenStreetMap), and because a customer naming a landmark is
 * more accurate than a geocoder guessing at a street.
 *
 * They live in the database so operations can add a new neighbourhood without a
 * deploy. They are read on the autocomplete hot path — every keystroke — so the
 * whole active list is cached in memory and dropped the moment an admin changes
 * anything.
 */

export interface SavedLocationRecord {
  id: string;
  name: string;
  address: string;
  landmark: string | null;
  lat: number;
  lng: number;
  isActive: boolean;
  sortOrder: number;
}

/** How long a cached list is trusted if nothing invalidates it. */
const CACHE_TTL_MS = 60_000;
const MAX_RESULTS = 500;

export const createSavedLocationSchema = z.object({
  name: z.string().trim().min(2, 'Give the place a name people will recognise').max(120),
  address: z.string().trim().min(3, 'An address is required').max(240),
  landmark: z.string().trim().max(160).optional().nullable(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  isActive: z.coerce.boolean().optional(),
});
export type CreateSavedLocationInput = z.infer<typeof createSavedLocationSchema>;

export const updateSavedLocationSchema = createSavedLocationSchema.partial();
export type UpdateSavedLocationInput = z.infer<typeof updateSavedLocationSchema>;

@Injectable()
export class SavedLocationsService {
  private readonly logger = new Logger(SavedLocationsService.name);
  private cache: { rows: SavedLocationRecord[]; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The active list, cached.
   *
   * If the table cannot be read — a deploy that has not run the migration yet,
   * say — this returns null and the caller falls back to the built-in table. A
   * missing table must never be the reason a customer cannot send a parcel.
   */
  async active(): Promise<SavedLocationRecord[] | null> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.rows;
    try {
      const rows = await this.prisma.savedLocation.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: MAX_RESULTS,
        select: { id: true, name: true, address: true, landmark: true, lat: true, lng: true, isActive: true, sortOrder: true },
      });
      this.cache = { rows, expiresAt: Date.now() + CACHE_TTL_MS };
      return rows;
    } catch (error) {
      this.logger.warn(`Could not read saved locations, using the built-in list: ${(error as Error).message}`);
      return null;
    }
  }

  /** Everything, active or not — the admin screen needs to see what it hid. */
  async list(): Promise<SavedLocationRecord[]> {
    return this.prisma.savedLocation.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      take: MAX_RESULTS,
      select: { id: true, name: true, address: true, landmark: true, lat: true, lng: true, isActive: true, sortOrder: true },
    });
  }

  async create(input: CreateSavedLocationInput, actorUserId: string): Promise<SavedLocationRecord> {
    const row = await this.prisma.savedLocation.create({
      data: {
        name: input.name,
        address: input.address,
        landmark: input.landmark ?? null,
        lat: input.lat,
        lng: input.lng,
        sortOrder: input.sortOrder ?? 100,
        isActive: input.isActive ?? true,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      select: { id: true, name: true, address: true, landmark: true, lat: true, lng: true, isActive: true, sortOrder: true },
    });
    this.invalidate();
    return row;
  }

  async update(id: string, input: UpdateSavedLocationInput, actorUserId: string): Promise<SavedLocationRecord> {
    const row = await this.prisma.savedLocation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.landmark !== undefined ? { landmark: input.landmark } : {}),
        ...(input.lat !== undefined ? { lat: input.lat } : {}),
        ...(input.lng !== undefined ? { lng: input.lng } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedById: actorUserId,
      },
      select: { id: true, name: true, address: true, landmark: true, lat: true, lng: true, isActive: true, sortOrder: true },
    });
    this.invalidate();
    return row;
  }

  /**
   * Hiding, not deleting.
   *
   * A saved location is the historical label for thousands of parcels that were
   * carried to that spot. Removing the row would not un-carry them, and it would
   * lose the only record of why that coordinate mattered. So the admin screen
   * hides a place; nothing in the delivery history changes.
   */
  async deactivate(id: string, actorUserId: string): Promise<SavedLocationRecord> {
    const row = await this.prisma.savedLocation.update({
      where: { id },
      data: { isActive: false, updatedById: actorUserId },
      select: { id: true, name: true, address: true, landmark: true, lat: true, lng: true, isActive: true, sortOrder: true },
    });
    this.invalidate();
    return row;
  }

  /** Called after every write, so an admin's change is visible on the next keystroke. */
  invalidate(): void {
    this.cache = null;
  }
}
