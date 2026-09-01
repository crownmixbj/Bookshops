import { useWindowDimensions } from 'react-native';
import { breakpoints } from '../theme';

/**
 * One place that decides "how wide are we", so no component invents its
 * own breakpoint. useWindowDimensions re-renders on rotation and on
 * browser resize, which is what makes the web layout live-responsive.
 *
 *   mobile  (<768)   single column, sidebar becomes a slide-over drawer,
 *                    order summary docks to the bottom of the screen
 *   tablet  (768+)   sidebar visible as a narrow icon rail, content in
 *                    two columns, order summary still docked
 *   desktop (1180+)  full three-column dashboard exactly like the mockup
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();

  const isDesktop = width >= breakpoints.desktop;
  const isTablet = width >= breakpoints.tablet && !isDesktop;
  const isMobile = width < breakpoints.tablet;

  return {
    width,
    height,
    isMobile,
    isTablet,
    isDesktop,
    /** Sidebar is a permanent column only on desktop. */
    sidebarMode: isDesktop ? 'full' : isTablet ? 'rail' : 'drawer',
    /** Right-hand order summary is a column on desktop, a dock elsewhere. */
    summaryMode: isDesktop ? 'column' : 'dock',
    /** Featured shops grid columns. */
    gridColumns: isDesktop ? 2 : isTablet ? 3 : 2,
    contentPadding: isMobile ? 12 : 20,
  };
}
