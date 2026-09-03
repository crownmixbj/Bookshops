import type { Ionicons } from '@expo/vector-icons';
import { RolePlaceholder } from './RolePlaceholder';

/** The vendor-bound form of RolePlaceholder, kept so the five vendor
 *  screens do not each have to repeat `audience="vendor"`. */
export function VendorPlaceholder(props: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  summary: string;
}) {
  return <RolePlaceholder {...props} audience="vendor" />;
}
