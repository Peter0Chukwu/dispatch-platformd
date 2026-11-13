import { useState } from "react";
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
import { adminNav } from "./nav";
import {
  usePricing,
  useUpdatePricingRule,
  type PricingOverview,
} from "../../hooks/useAdmin";

type Rule = PricingOverview["rules"][number];

/** Fees are edited in naira — what an operator thinks in — and stored as integer kobo. */
const FIELDS: Array<{ key: keyof Rule; label: string; help: string }> = [
  { key: "baseFeeKobo", label: "Base fee", help: "charged on every order" },
  {
    key: "perKmFeeKobo",
    label: "Per kilometre",
    help: "after the free distance",
  },
  {
    key: "minFeeKobo",
    label: "Minimum fee",
    help: "floor for very short trips",
  },
  {
    key: "expressSurchargeKobo",
    label: "Express surcharge",
    help: "priority pickup",
  },
  {
    key: "scheduledSurchargeKobo",
    label: "Scheduled surcharge",
    help: "booked for later",
  },
  {
    key: "sameDaySurchargeKobo",
    label: "Same-day surcharge",
    help: "delivered today",
  },
  {
    key: "additionalStopFeeKobo",
    label: "Additional stop",
    help: "each extra stop",
  },
];

const koboToNaira = (kobo: string) => (Number(kobo) / 100).toFixed(2);

export default function PricingPage() {
  const { hasPermission } = useAuth();
  const pricing = usePricing();
  const [editing, setEditing] = useState<Rule | null>(null);

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Pricing &amp; zones
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            What a customer is charged, and where you deliver. Changing a rule
            never rewrites a past delivery — each quote is frozen when it is
            created.
          </p>
        </div>

        {pricing.isError ? (
          <ErrorState
            title="Could not load pricing"
            message={(pricing.error as Error)?.message}
            onRetry={() => void pricing.refetch()}
          />
        ) : pricing.isPending || !pricing.data ? (
          <LoadingBlock rows={6} />
        ) : (
          <>
            {pricing.data.rules.map((rule) => (
              <Card key={rule.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {rule.name}
                      <Badge tone={rule.isActive ? "success" : "neutral"}>
                        {rule.isActive ? "active" : "retired"}
                      </Badge>
                    </span>
                  }
                  subtitle={`${rule.scopeOf} · version ${rule.version} · commission ${rule.defaultCommissionPct}% · rounds to ${rule.roundToKobo} kobo`}
                  action={
                    hasPermission("pricing:write") ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(rule)}
                      >
                        Edit fees
                      </Button>
                    ) : null
                  }
                />
                <CardBody>
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {FIELDS.map((field) => (
                      <div key={field.key}>
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                          {field.label}
                        </dt>
                        <dd className="mt-0.5 text-lg font-semibold text-ink-900">
                          {formatKobo(rule[field.key] as string)}
                        </dd>
                        <p className="text-xs text-ink-500">{field.help}</p>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 text-xs text-ink-500">
                    First {rule.freeKmIncluded} km are included in the base fee.
                    Last edited{" "}
                    {new Date(rule.updatedAt).toLocaleString("en-NG")}
                    {rule.createdBy ? ` by ${rule.createdBy}` : ""}.
                  </p>
                </CardBody>
              </Card>
            ))}

            <Card>
              <CardHeader
                title="Service zones"
                subtitle="Coverage areas used for routing, pricing and reporting"
              />
              <CardBody>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                      <th className="pb-2">Zone</th>
                      <th className="pb-2">Code</th>
                      <th className="pb-2 text-right">Radius</th>
                      <th className="pb-2 text-right">Deliveries</th>
                      <th className="pb-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricing.data.zones.map((zone) => (
                      <tr key={zone.id} className="border-t border-ink-100">
                        <td className="py-2 text-ink-800">{zone.name}</td>
                        <td className="py-2 font-mono text-xs text-ink-600">
                          {zone.code}
                        </td>
                        <td className="py-2 text-right text-ink-600">
                          {zone.radiusKm ? `${zone.radiusKm} km` : "—"}
                        </td>
                        <td className="py-2 text-right text-ink-600">
                          {zone.deliveries}
                        </td>
                        <td className="py-2 text-right">
                          <Badge tone={zone.isActive ? "success" : "neutral"}>
                            {zone.isActive ? "live" : "off"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Alert tone="warning" title="These are the seeded Benin City defaults">
              Swap them for your real city tariffs whenever you are ready —
              either here, or by updating the seeded configuration. No code
              change is needed.
            </Alert>
          </>
        )}

        <EditRuleModal
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void pricing.refetch();
          }}
        />
      </div>
    </PortalShell>
  );
}

const formatKobo = (kobo: string) =>
  (Number(kobo) / 100).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
  });

function EditRuleModal({
  rule,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const update = useUpdatePricingRule();
  const [values, setValues] = useState<Record<string, string>>({});
  const [commission, setCommission] = useState<string>("");

  // Reset the form whenever a different rule is opened.
  const ruleId = rule?.id ?? null;
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (ruleId && ruleId !== loadedId) {
    setLoadedId(ruleId);
    setValues(
      Object.fromEntries(
        FIELDS.map((field) => [
          field.key,
          koboToNaira(rule![field.key] as string),
        ]),
      ),
    );
    setCommission(String(rule!.defaultCommissionPct));
  }

  const save = async () => {
    if (!rule) return;
    const changes: Record<string, number> = {};
    for (const field of FIELDS) {
      const raw = values[field.key];
      const next = Number(raw);
      if (raw !== undefined && raw !== "" && Number.isFinite(next)) {
        const original = koboToNaira(rule[field.key] as string);
        if (next.toFixed(2) !== original) {
          // Server expects naira for money fields.
          changes[field.key.replace(/Kobo$/, "Naira")] = next;
        }
      }
    }
    const commissionValue = Number(commission);
    if (
      Number.isFinite(commissionValue) &&
      commissionValue !== rule.defaultCommissionPct
    ) {
      changes.defaultCommissionPct = commissionValue;
    }

    if (Object.keys(changes).length === 0) {
      notify({ tone: "info", title: "Nothing changed" });
      return;
    }

    try {
      await update.mutateAsync({ ruleId: rule.id, changes });
      notify({
        tone: "success",
        title: "Pricing updated",
        description: "New quotes use the new fee immediately.",
      });
      onSaved();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not save the pricing",
        description: (error as Error).message,
      });
    }
  };

  return (
    <Modal
      open={Boolean(rule)}
      onClose={onClose}
      title={rule ? `Edit ${rule.name}` : "Edit pricing"}
      description="Amounts are entered in naira (₦) and stored as whole kobo."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button isLoading={update.isPending} onClick={() => void save()}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            label={`${field.label} (₦)`}
            hint={field.help}
            htmlFor={`fee-${field.key}`}
          >
            <Input
              id={`fee-${field.key}`}
              inputMode="decimal"
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.key]: event.target.value,
                }))
              }
            />
          </Field>
        ))}
        <Field
          label="Commission (%)"
          hint="The rider's share of the charge"
          htmlFor="fee-commission"
        >
          <Input
            id="fee-commission"
            inputMode="decimal"
            value={commission}
            onChange={(event) => setCommission(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
