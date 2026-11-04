import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, CardBody } from '../components/ui';

/**
 * Honest placeholder. It states exactly what is being built next and when —
 * no fake dashboard, no dummy statistics, no dead buttons.
 */
export default function PortalPlaceholder({
  portal,
  phase,
  scope,
}: {
  portal: string;
  phase: string;
  scope: string[];
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-5">
      <Card className="w-full max-w-lg">
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <Badge tone="brand">{portal} portal</Badge>
            <Badge tone="warning">{phase} — not built yet</Badge>
          </div>
          <h1 className="text-xl font-bold text-ink-900">{portal} portal is scheduled for {phase}</h1>
          <p className="text-sm leading-relaxed text-ink-600">
            Phase 1 delivered the foundation: database schema, seed data, authenticated API shell and this design
            system. This portal will be built on top of that foundation and will use the same API and database as the
            other two.
          </p>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Planned in this phase</p>
            <ul className="space-y-1.5 text-sm text-ink-700">
              {scope.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <Alert tone="info" title="No placeholder data here">
            Screens are added only when they read and write real records, so nothing you see is fabricated.
          </Alert>
          <Link to="/">
            <Button variant="secondary" fullWidth>
              Back to overview
            </Button>
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
