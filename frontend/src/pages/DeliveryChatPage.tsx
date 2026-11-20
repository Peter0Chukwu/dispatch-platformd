import { Link, useParams } from 'react-router-dom';
import { Card, CardBody } from '../components/ui';
import { ContactCard } from '../components/ContactCard';
import { PortalShell } from '../layouts/PortalShell';
import { CUSTOMER_NAV } from './customer/nav';
import { RIDER_NAV } from './rider/nav';

/**
 * ONE JOB, ONE THREAD
 *
 * Accepting an offer drops both people here, because the next thing either of them
 * wants is the other one's answer to a question — "which gate?", "I am outside".
 *
 * This is not an inbox and there is no list of chats: the thread belongs to a
 * delivery, it exists only while that delivery is live, and it disappears from both
 * portals when the job is done. That is the promise that nobody takes a phone number
 * away from this platform.
 */
export function DeliveryChatPage({ portal }: { portal: 'Customer' | 'Rider' }) {
  const { id } = useParams<{ id: string }>();
  const isCustomer = portal === 'Customer';
  const backTo = isCustomer ? '/app/deliveries' : '/rider/active';

  return (
    <PortalShell portal={portal} nav={isCustomer ? CUSTOMER_NAV : RIDER_NAV}>
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <Link to={backTo} className="text-sm font-medium text-brand-700 hover:underline">
            ← {isCustomer ? 'All deliveries' : 'My active job'}
          </Link>
          {isCustomer && id && (
            <Link to={`/app/deliveries/${id}`} className="text-sm font-medium text-brand-700 hover:underline">
              Delivery details →
            </Link>
          )}
        </div>

        <Card>
          <CardBody className="p-0">
            {id ? (
              <ContactCard deliveryId={id} perspective={isCustomer ? 'CUSTOMER' : 'RIDER'} />
            ) : (
              <p className="p-6 text-sm text-ink-500">This chat has no delivery attached.</p>
            )}
          </CardBody>
        </Card>

        <p className="px-1 text-xs leading-relaxed text-ink-400">
          Chat and calls stay inside the app on purpose. Neither of you sees the other's phone number, and this thread
          closes when the delivery is finished.
        </p>
      </div>
    </PortalShell>
  );
}
