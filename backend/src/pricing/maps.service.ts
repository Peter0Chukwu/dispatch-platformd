import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app.config';
import { estimateRoute, type Point, type RouteEstimate } from './distance';

/**
 * MapsService — the only place that knows how routes are measured.
 *
 * Today `MAPS_PROVIDER=stub` (haversine × road factor). When the Google Maps key
 * is configured, `MAPS_PROVIDER=google` switches this to the Directions API and
 * NOTHING ELSE in the codebase has to change: PricingService only ever calls
 * `estimateRoute()` and receives the same shape back.
 */
@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);

  constructor(private readonly config: AppConfig) {}

  get provider(): 'stub' | 'google' | 'mapbox' {
    return this.config.mapsProviderKey;
  }

  /**
   * Distance and duration between two points.
   * Never throws for valid coordinates; a failed Google call falls back to the
   * stub so a booking is never blocked by a third-party outage.
   */
  async estimateRoute(from: Point, to: Point): Promise<RouteEstimate> {
    if (this.provider === 'google') {
      try {
        return await this.googleRoute(from, to);
      } catch (error) {
        this.logger.warn(
          `Google Directions failed, falling back to stub estimate: ${(error as Error).message}`,
        );
      }
    }
    return estimateRoute(from, to);
  }

  private async googleRoute(from: Point, to: Point): Promise<RouteEstimate> {
    const key = this.config.googleMapsApiKey;
    if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not configured');

    const url =
      'https://maps.googleapis.com/maps/api/directions/json' +
      `?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}` +
      `&mode=driving&region=ng&key=${encodeURIComponent(key)}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Directions responded ${response.status}`);

    const body = (await response.json()) as {
      status: string;
      routes?: { legs: { distance: { value: number }; duration: { value: number } }[] }[];
    };
    if (body.status !== 'OK' || !body.routes?.length) {
      throw new Error(`Directions status ${body.status}`);
    }

    const legs = body.routes[0]!.legs;
    const metres = legs.reduce((sum, leg) => sum + leg.distance.value, 0);
    const seconds = legs.reduce((sum, leg) => sum + leg.duration.value, 0);

    return {
      distanceKm: Math.round((metres / 1000) * 100) / 100,
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      source: 'GOOGLE',
    };
  }
}
