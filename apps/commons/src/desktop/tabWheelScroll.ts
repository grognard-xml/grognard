/** How far a wheel event should move a horizontal scroller. A mouse wheel turns vertically, so its
 * vertical delta is used unless the gesture is mainly horizontal (a trackpad swipe). */
export const horizontalWheelDelta = (
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  pageWidth: number,
): number => {
  const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (event.deltaMode === 1) return raw * 16; // lines
  if (event.deltaMode === 2) return raw * pageWidth; // pages
  return raw;
};

/**
 * Lets the wheel scroll a row of tabs sideways. MUI's scrollable tabs hide their overflow, so the
 * wheel does nothing on its own. The event is only taken over when the row actually overflows and
 * can still move that way, so at either end it goes on to whatever is underneath. Returns the
 * function that removes the listener.
 */
export const attachTabWheelScroll = (root: HTMLElement): (() => void) => {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return; // pinch-zoom on a trackpad
    const scroller = root.querySelector<HTMLElement>('.MuiTabs-scroller');
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;

    const delta = horizontalWheelDelta(event, scroller.clientWidth);
    if (delta === 0) return;

    const max = scroller.scrollWidth - scroller.clientWidth;
    const next = Math.min(max, Math.max(0, scroller.scrollLeft + delta));
    if (next === scroller.scrollLeft) return;

    event.preventDefault();
    scroller.scrollLeft = next;
  };

  // Not passive: it has to be able to stop the page from also reacting to the wheel.
  root.addEventListener('wheel', onWheel, { passive: false });
  return () => root.removeEventListener('wheel', onWheel);
};
