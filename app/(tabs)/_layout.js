import { Stack } from 'expo-router';

/**
 * A Stack, not Tabs, despite the (tabs) folder name.
 *
 * The dashboard carries its own persistent sidebar (Dashboard, My
 * Booklists, My Orders, Saved Shops, Settings, Logout), so a bottom tab
 * bar would duplicate that navigation on mobile and fight the docked
 * order-summary bar for the same strip of screen.
 *
 * If you later want real bottom tabs on mobile, swap Stack for Tabs here
 * and render the Sidebar only when useLayout().isDesktop is true.
 */
export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
