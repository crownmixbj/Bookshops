import { VendorPlaceholder } from '../../components/layout/VendorPlaceholder';

/**
 * Was /vendor/messaging. Renamed to /vendor/messages so the URL names
 * the thing rather than the activity, matching /vendor/quotes and
 * /vendor/orders. The old path redirects here.
 */
export default function VendorMessagesScreen() {
  return (
    <VendorPlaceholder
      icon="chatbubble-outline"
      title="Messaging"
      summary="Conversations with buyers about a quote or an order in progress."
    />
  );
}
