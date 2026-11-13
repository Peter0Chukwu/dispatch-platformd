import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { extname } from 'node:path';
import { StorageService } from './storage.service';
import { AppError } from '../common/errors/app-error';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

/**
 * READ-BACK FOR DISPLAY PICTURES.
 *
 * The API hands out an `avatarUrl` of the form `/api/v1/files/avatars/<uuid>.jpg`.
 * Until now nothing answered that path, so every avatar in the product was a
 * broken image and the fallback initials were doing all the work.
 *
 * This route is deliberately narrow: it serves the `avatars/` prefix and nothing
 * else. Parcel photos, rider documents and delivery proofs have their own
 * endpoints, each with its own rules about who may look — a single "get any file
 * by key" route would quietly bypass every one of those checks.
 *
 * Avatars are readable by any signed-in account, because a colleague's face has
 * to render in a staff list; the key still contains a random UUID, so it cannot
 * be guessed, and the response is marked private so no shared cache keeps a copy.
 */
@Controller('files')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get('avatars/:file')
  async avatar(@Param('file') file: string, @Res() res: Response) {
    // `file` is the name only — a key containing ../ must never reach the disk.
    if (!/^[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp)$/.test(file)) {
      throw AppError.notFound('File');
    }
    const key = `avatars/${file}`;
    let buffer: Buffer;
    try {
      buffer = await this.storage.readBuffer(key);
    } catch {
      throw AppError.notFound('File');
    }
    res.setHeader('Content-Type', MIME_BY_EXTENSION[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  }
}
