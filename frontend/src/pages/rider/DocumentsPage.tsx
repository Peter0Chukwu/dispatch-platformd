import { useRef, useState } from 'react';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Spinner,
  StatusPill,
  useToast,
} from '../../components/ui';
import { RIDER_NAV } from './nav';
import { useApiError } from '../../contexts/AuthContext';
import { useRiderProfile, useUploadDocument, type DocumentType, type RiderDocument } from '../../hooks/useRider';

const LABELS: Record<DocumentType, { title: string; hint: string }> = {
  NIN: { title: 'National ID (NIN)', hint: 'Your NIN slip or national ID card.' },
  DRIVERS_LICENCE: { title: "Driver's licence", hint: 'A valid licence for the vehicle you ride.' },
  VEHICLE_REGISTRATION: { title: 'Vehicle registration', hint: 'Vehicle licence or registration papers.' },
  PROOF_OF_ADDRESS: { title: 'Proof of address', hint: 'A utility bill or bank statement from the last 3 months.' },
  GUARANTOR_FORM: { title: 'Guarantor form', hint: 'Signed form from your guarantor.' },
  SELFIE: { title: 'Selfie', hint: 'A clear photo of your face, well lit.' },
};

const ACCEPTED = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_BYTES = 5 * 1024 * 1024;

export default function DocumentsPage() {
  const { notify } = useToast();
  const profile = useRiderProfile();
  const upload = useUploadDocument();
  const [busyType, setBusyType] = useState<DocumentType | null>(null);

  if (profile.isLoading) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </PortalShell>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <ErrorState title="We could not load your documents" onRetry={() => void profile.refetch()} />
      </PortalShell>
    );
  }

  const rider = profile.data;
  const byType = new Map<DocumentType, RiderDocument>(rider.documents.map((doc) => [doc.type, doc]));

  const send = async (docType: DocumentType, file: File) => {
    if (file.size > MAX_BYTES) {
      notify({ tone: 'error', title: 'File too large', description: 'Documents must be smaller than 5 MB.' });
      return;
    }
    setBusyType(docType);
    try {
      await upload.mutateAsync({ docType, mimeType: file.type, base64: await fileToBase64(file) });
      notify({
        tone: 'success',
        title: 'Document uploaded',
        description: 'It is now pending review. A Rider Manager checks it before you can go online.',
      });
    } catch (error) {
      notify({ tone: 'error', title: 'Could not upload', description: useApiError(error) ?? 'Please try again.' });
    } finally {
      setBusyType(null);
    }
  };

  const approvedCount = rider.documents.filter((doc) => doc.status === 'APPROVED').length;

  return (
    <PortalShell portal="Rider" nav={RIDER_NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">Documents</h1>
            <p className="mt-1 text-sm text-ink-500">
              {approvedCount} of {rider.requiredDocuments.length} approved. Uploads are stored privately — a document is
              never reachable by a public link.
            </p>
          </div>
          <StatusPill
            label={rider.canGoOnline ? 'Cleared to work' : 'Not cleared yet'}
            tone={rider.canGoOnline ? 'success' : 'warning'}
          />
        </div>

        {rider.missingDocuments.length > 0 && (
          <Alert tone="warning" title={`${rider.missingDocuments.length} document(s) still needed`}>
            You cannot go online until these are uploaded <em>and</em> approved:{' '}
            {rider.missingDocuments.map((type) => LABELS[type].title).join(', ')}.
          </Alert>
        )}

        {rider.documents.some((doc) => doc.status === 'REJECTED') && (
          <Alert tone="danger" title="A document was rejected">
            Check the reviewer’s note under the document and upload a better copy.
          </Alert>
        )}

        <Card>
          <CardHeader title="Required documents" subtitle="JPEG, PNG, WebP or PDF · up to 5 MB each" />
          <CardBody className="divide-y divide-ink-100">
            {rider.requiredDocuments.map((type) => (
              <DocumentRow
                key={type}
                docType={type}
                document={byType.get(type)}
                busy={busyType === type}
                onFile={(file) => void send(type, file)}
              />
            ))}
          </CardBody>
        </Card>

        <p className="pb-4 text-center text-xs text-ink-500">
          Review usually happens within one working day. You will see the status change here as soon as it is decided.
        </p>
      </div>
    </PortalShell>
  );
}

function DocumentRow({
  docType,
  document,
  busy,
  onFile,
}: {
  docType: DocumentType;
  document: RiderDocument | undefined;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const label = LABELS[docType];
  const tone =
    document?.status === 'APPROVED'
      ? 'success'
      : document?.status === 'REJECTED'
        ? 'danger'
        : document
          ? 'warning'
          : 'neutral';

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">{label.title}</p>
        <p className="text-xs text-ink-500">{label.hint}</p>
        {document && (
          <p className="mt-1 text-[11px] text-ink-400">
            Uploaded {new Date(document.uploadedAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
          </p>
        )}
        {document?.status === 'REJECTED' && document.reviewNote && (
          <p className="mt-1 text-xs font-medium text-danger-600">Reviewer: {document.reviewNote}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Badge tone={tone}>{document ? document.status.toLowerCase() : 'not uploaded'}</Badge>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          isLoading={busy}
          onClick={() => inputRef.current?.click()}
        >
          {document ? 'Replace' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
