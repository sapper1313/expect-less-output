/** Under this width the left menu becomes a drawer. */
export const DRAWER_BELOW_PX = 900
export const needsDrawer = (widthPx: number): boolean => widthPx < DRAWER_BELOW_PX
