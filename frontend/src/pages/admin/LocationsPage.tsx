import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../lib/api";
import { adminNav } from "./nav";

/**
 * SAVED PLACES
 *
 * The pickup and drop-off points the booking form offers before anyone types an
 * address. This screen is the whole reason the list lives in a database: a new
 * neighbourhood becomes a row here, not a deploy.
 *
 * Coordinates are the one thing that must be right — every fare and every dispatch
 * radius is measured from them — so the form will fill them in from an address via
 * the same geocoder the booking form uses, and shows what it found before saving.
 */

interface SavedLocation {
  id: string;
  name: string;
  address: string;
  landmark: string | null;
  lat: number;
  lng: number;
  isActive: boolean;
  sortOrder: number;
}

interface Draft {
  id: string | null;
  name: string;
  address: string;
  landmark: string;
  lat: string;
  lng: string;
  sortOrder: string;
}

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  address: "",
  landmark: "",
  lat: "",
  lng: "",
  sortOrder: "100",
});

const draftFrom = (row: SavedLocation): Draft => ({
  id: row.id,
  name: row.name,
  address: row.address,
  landmark: row.landmark ?? "",
  lat: String(row.lat),
  lng: String(row.lng),
  sortOrder: String(row.sortOrder),
});

export default function LocationsPage() {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const canWrite = hasPermission("settings:write");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [confirmHide, setConfirmHide] = useState<SavedLocation | null>(null);

  const locations = useQuery({
    queryKey: ["admin", "saved-locations"],
    queryFn: () => api.get<SavedLocation[]>("/admin/locations"),
    staleTime: 15_000,
  });

  const save = useMutation({
    mutationFn: (values: Draft) => {
      const body = {
        name: values.name.trim(),
        address: values.address.trim(),
        landmark: values.landmark.trim() || null,
        lat: Number(values.lat),
        lng: Number(values.lng),
        sortOrder: Number(values.sortOrder) || 100,
      };
      return values.id
        ? api.patch<SavedLocation>(`/admin/locations/${values.id}`, body)
        : api.post<SavedLocation>("/admin/locations", body);
    },
    onSuccess: (row) => {
      notify({
        tone: "success",
        title: draft?.id ? `${row.name} updated` : `${row.name} added`,
        description: draft?.id
          ? "The booking form picks this up straight away."
          : "It is in the booking form now — no deploy needed.",
      });
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "saved-locations"] });
      void queryClient.invalidateQueries({ queryKey: ["maps", "saved-locations"] });
    },
  });

  const restore = useMutation({
    mutationFn: (row: SavedLocation) =>
      api.patch<SavedLocation>(`/admin/locations/${row.id}`, { isActive: true }),
    onSuccess: (row) => {
      notify({ tone: "success", title: `${row.name} is back on the booking form` });
      void queryClient.invalidateQueries({ queryKey: ["admin", "saved-locations"] });
      void queryClient.invalidateQueries({ queryKey: ["maps", "saved-locations"] });
    },
  });

  const hide = useMutation({
    mutationFn: (row: SavedLocation) => api.delete<{ message: string }>(`/admin/locations/${row.id}`),
    onSuccess: (result) => {
      notify({ tone: "success", title: result.message });
      setConfirmHide(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "saved-locations"] });
      void queryClient.invalidateQueries({ queryKey: ["maps", "saved-locations"] });
    },
  });

  const rows = useMemo(() => {
    const all = locations.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((row) =>
      `${row.name} ${row.address} ${row.landmark ?? ""}`.toLowerCase().includes(needle),
    );
  }, [locations.data, search]);

  const activeCount = (locations.data ?? []).filter((row) => row.isActive).length;

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Saved places</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-500">
              The pickup and drop-off points the booking form offers before a customer types
              anything. Fares and dispatch distances are measured from these coordinates, so a
              place added here is usable immediately — no deploy, no code change.
            </p>
          </div>
          {canWrite && (
            <Button onClick={() => setDraft(emptyDraft())}>Add a place</Button>
          )}
        </div>

        <Alert tone="info" title={`${activeCount} places on the booking form`}>
          Customers can still type any address — this list is the shortcut, and it is what covers
          places a map database does not know about (most of Benin City&apos;s informal landmarks).
        </Alert>

        <Card>
          <CardHeader
            title="All places"
            subtitle="Hidden places stay in the record; they simply stop appearing to customers."
            action={
              <Input
                aria-label="Search places"
                placeholder="Search name, address or landmark"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full sm:w-64"
              />
            }
          />
          <CardBody>
            {locations.isError ? (
              <ErrorState
                title="Could not load the list"
                message={(locations.error as Error)?.message}
                onRetry={() => void locations.refetch()}
              />
            ) : locations.isPending ? (
              <LoadingBlock rows={5} />
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-500">
                Nothing matches “{search}”. {canWrite ? "Add it with the button above." : ""}
              </p>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                      <th className="pb-2">Place</th>
                      <th className="pb-2">Order</th>
                      <th className="pb-2">Coordinates</th>
                      <th className="pb-2 text-right">Shown</th>
                      <th className="pb-2 text-right">{canWrite ? "Manage" : ""}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-ink-100 align-top">
                        <td className="py-3">
                          <p className="font-medium text-ink-900">{row.name}</p>
                          <p className="text-xs text-ink-500">{row.address}</p>
                          {row.landmark && (
                            <p className="text-xs text-ink-400">{row.landmark}</p>
                          )}
                        </td>
                        <td className="py-3 tabular-nums text-ink-600">{row.sortOrder}</td>
                        <td className="py-3 font-mono text-xs text-ink-600">
                          {row.lat.toFixed(4)}, {row.lng.toFixed(4)}
                        </td>
                        <td className="py-3 text-right">
                          <Badge tone={row.isActive ? "success" : "neutral"}>
                            {row.isActive ? "live" : "hidden"}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          {canWrite && (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="secondary" onClick={() => setDraft(draftFrom(row))}>
                                Edit
                              </Button>
                              {row.isActive ? (
                                <Button size="sm" variant="ghost" onClick={() => setConfirmHide(row)}>
                                  Hide
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => restore.mutate(row)}
                                  disabled={restore.isPending}
                                >
                                  Restore
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <PlaceForm
        draft={draft}
        saving={save.isPending}
        error={save.isError ? ((save.error as Error)?.message ?? "Could not save") : null}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSave={() => draft && save.mutate(draft)}
      />

      <Modal
        open={!!confirmHide}
        onClose={() => setConfirmHide(null)}
        title="Hide this place?"
        description={confirmHide ? `${confirmHide.name} will stop appearing on the booking form.` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmHide(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={hide.isPending}
              onClick={() => confirmHide && hide.mutate(confirmHide)}
            >
              {hide.isPending ? "Hiding…" : "Hide it"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-600">
          Nothing is deleted. Deliveries already carried to this spot keep their record, and you can
          put the place back at any time with <strong>Restore</strong>.
        </p>
      </Modal>
    </PortalShell>
  );
}

/* ───────────────────────────── the form ───────────────────────────── */

function PlaceForm({
  draft,
  saving,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft | null;
  saving: boolean;
  error: string | null;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [lookup, setLookup] = useState<"idle" | "searching" | "missing">("idle");
  const [found, setFound] = useState<string | null>(null);

  const set = (patch: Partial<Draft>) => draft && onChange({ ...draft, ...patch });

  /**
   * The coordinates matter more than the address, so this asks the geocoder rather
   * than trusting a typed number. What it found is shown before it is applied —
   * silently snapping to the wrong place is how a fare goes wrong.
   */
  const findCoordinates = async () => {
    if (!draft || draft.address.trim().length < 3) return;
    setLookup("searching");
    setFound(null);
    try {
      const result = await api.get<{
        data: { address: string; lat: number; lng: number; approximate: boolean } | null;
      }>(`/maps/geocode?address=${encodeURIComponent(draft.address.trim())}`);
      if (!result.data) {
        setLookup("missing");
        return;
      }
      setLookup("idle");
      set({ lat: result.data.lat.toFixed(6), lng: result.data.lng.toFixed(6) });
      setFound(
        result.data.approximate
          ? `Closest match: ${result.data.address} — check the pin before saving.`
          : `Found: ${result.data.address}`,
      );
    } catch {
      setLookup("missing");
    }
  };

  const valid =
    !!draft &&
    draft.name.trim().length >= 2 &&
    draft.address.trim().length >= 3 &&
    Number.isFinite(Number(draft.lat)) &&
    Number.isFinite(Number(draft.lng)) &&
    draft.lat !== "" &&
    draft.lng !== "";

  return (
    <Modal
      open={!!draft}
      onClose={onCancel}
      title={draft?.id ? "Edit place" : "Add a place"}
      description="A landmark customers will recognise, the address behind it, and the exact coordinates fares are measured from."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!valid || saving}>
            {saving ? "Saving…" : draft?.id ? "Save changes" : "Add place"}
          </Button>
        </div>
      }
    >
      {draft && (
        <div className="space-y-3">
          {error && <Alert tone="danger" title="Not saved">{error}</Alert>}

          <Field label="Name" required hint="What a customer would type or say">
            <Input
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="Ikpoba Hill"
              autoFocus
            />
          </Field>

          <Field label="Address" required hint="Street and area, as it should read on a receipt">
            <Input
              value={draft.address}
              onChange={(event) => set({ address: event.target.value })}
              placeholder="Benin-Auchi Road, Ikpoba Hill, Benin City"
            />
          </Field>

          <Field label="Landmark" hint="The sentence that actually gets a rider there">
            <Input
              value={draft.landmark}
              onChange={(event) => set({ landmark: event.target.value })}
              placeholder="By the Ikpoba River bridge"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Latitude" required>
              <Input
                value={draft.lat}
                onChange={(event) => set({ lat: event.target.value })}
                placeholder="6.3565"
                inputMode="decimal"
              />
            </Field>
            <Field label="Longitude" required>
              <Input
                value={draft.lng}
                onChange={(event) => set({ lng: event.target.value })}
                placeholder="5.6691"
                inputMode="decimal"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void findCoordinates()}
              disabled={lookup === "searching" || draft.address.trim().length < 3}
            >
              {lookup === "searching" ? "Looking…" : "Find coordinates from the address"}
            </Button>
            <p className="text-xs text-ink-500">
              {lookup === "missing"
                ? "No coordinates found for that address — type them in, or refine the address."
                : (found ?? "Or paste the coordinates if you have them.")}
            </p>
          </div>

          <Field label="Order" hint="Lower numbers appear first in the list">
            <Input
              value={draft.sortOrder}
              onChange={(event) => set({ sortOrder: event.target.value })}
              inputMode="numeric"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
