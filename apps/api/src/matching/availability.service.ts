import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { type Availability, type GeoPoint, HELPER_RADIUS_DEFAULT_M, type SetAvailability } from '@sibimate/shared';
import { eq, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { type HelperProfileRow, helperAvailability } from '../db/schema.js';
import { Notifier } from '../live/notifier.js';

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly notifier: Notifier,
  ) {}

  async get(helper: HelperProfileRow): Promise<Availability> {
    const [row] = await this.db
      .select({ isOnline: helperAvailability.isOnline, radiusM: helperAvailability.radiusM })
      .from(helperAvailability)
      .where(eq(helperAvailability.helperId, helper.id));
    return row ?? { isOnline: false, radiusM: HELPER_RADIUS_DEFAULT_M };
  }

  /** Switches the helper online or offline. Going online needs a location, now or from earlier. */
  async set(helper: HelperProfileRow, { isOnline, radiusM, location }: SetAvailability): Promise<Availability> {
    const changes = {
      isOnline,
      ...(radiusM !== undefined && { radiusM }),
      ...(location && { lastLocation: location }),
      seenAt: new Date(),
    };
    const [row] = await this.db
      .insert(helperAvailability)
      .values({ helperId: helper.id, ...changes })
      .onConflictDoUpdate({ target: helperAvailability.helperId, set: changes })
      .returning({
        isOnline: helperAvailability.isOnline,
        radiusM: helperAvailability.radiusM,
        located: sql<boolean>`${helperAvailability.lastLocation} is not null`,
      });
    if (isOnline && !row!.located) {
      await this.db
        .update(helperAvailability)
        .set({ isOnline: false })
        .where(eq(helperAvailability.helperId, helper.id));
      throw new ApiException(400, 'validation_failed', 'Validation failed', [
        { path: 'location', message: 'Send your location to go online.' },
      ]);
    }
    return { isOnline: row!.isOnline, radiusM: row!.radiusM };
  }

  /** The app's report, about once a minute while online. Only the latest point is kept. */
  async reportLocation(helper: HelperProfileRow, location: GeoPoint): Promise<void> {
    await this.db
      .insert(helperAvailability)
      .values({ helperId: helper.id, lastLocation: location, seenAt: new Date() })
      .onConflictDoUpdate({ target: helperAvailability.helperId, set: { lastLocation: location, seenAt: new Date() } });
    await this.notifier.helperMoved(helper, location);
  }
}
