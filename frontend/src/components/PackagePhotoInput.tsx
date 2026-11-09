import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui';

/**
 * Photograph the parcel, then upload it before the booking is submitted.
 *
 * A phone camera produces 3–6 MB images, and the API rejects bodies over 8 MB
 * once base64 has inflated them by a third. So the image is downscaled in the
 * browser first: 1600 px on the long edge at JPEG q0.78 lands around 200–350 kB,
 * which is legible evidence of a parcel's condition and fast on mobile data.
 *
 * The upload happens immediately (not on submit) so the customer sees a real
 * preview of the exact bytes the rider will see, and so a network failure is
 * visible while they can still do something about it.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.78;

async function downscale(file: File): Promise<{ base64: string; mimeType: 'image/jpeg' }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the photo');
  context.drawImage(bitmap, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = dataUrl.split(',')[1] ?? '';
  return { base64, mimeType: 'image/jpeg' };
}

export function PackagePhotoInput({
  value,
  onChange,
}: {
  value?: string;
  onChange: (key: string | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('Attach a photo (JPEG, PNG or WebP).');
      return;
    }

    setBusy(true);
    try {
      const { base64, mimeType } = await downscale(file);
      const result = await api.post<{ packagePhotoKey: string }>('/deliveries/package-photo', {
        mimeType,
        base64,
      });
      onChange(result.packagePhotoKey);
      setPreview(URL.createObjectURL(file));
    } catch {
      setError('The photo could not be uploaded. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    onChange(undefined);
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />

      {preview ? (
        <div className="flex items-start gap-3">
          <img src={preview} alt="The parcel you are sending" className="h-24 w-24 rounded-xl object-cover" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-accent-700">Photo attached</p>
            <p className="text-xs text-ink-500">The rider sees this before accepting.</p>
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              Replace or remove
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          fullWidth
          isLoading={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Uploading photo…' : 'Take or choose a photo'}
        </Button>
      )}

      {value && !preview && <p className="text-xs text-ink-500">Photo uploaded.</p>}
      {error && <p className="text-xs text-danger-600">{error}</p>}
    </div>
  );
}
