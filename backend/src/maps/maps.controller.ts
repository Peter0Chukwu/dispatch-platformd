import { Controller, Get, Query } from '@nestjs/common';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { MapsService } from '../pricing/maps.service';

/**
 * Address lookup for the booking form.
 *
 * Public on purpose: the sign-up form needs suggestions before a customer has a
 * token, and the answers contain no private data. Rate-limited because each call
 * can become a billed Google request — 30 lookups a minute per IP is plenty for
 * one human typing an address.
 */
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Public()
  @Get('places')
  @RateLimit({ points: 30, windowSeconds: 60, keyBy: 'ip+route' })
  async places(@Query('q') query?: string) {
    const results = await this.maps.autocomplete(query ?? '', 6);
    return { data: results, provider: this.maps.provider };
  }

  @Public()
  @Get('geocode')
  @RateLimit({ points: 20, windowSeconds: 60, keyBy: 'ip+route' })
  geocode(@Query('address') address?: string) {
    return this.maps.geocode(address ?? '').then((result) => ({ data: result, provider: this.maps.provider }));
  }

  @Public()
  @Get('reverse')
  @RateLimit({ points: 20, windowSeconds: 60, keyBy: 'ip+route' })
  reverse(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    const point = { lat: Number(lat), lng: Number(lng) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      return { data: null, provider: this.maps.provider };
    }
    return this.maps.reverseGeocode(point).then((result) => ({ data: result, provider: this.maps.provider }));
  }
}
