import { attachTabWheelScroll, horizontalWheelDelta } from './tabWheelScroll';

const build = ({ scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) => {
  const root = document.createElement('div');
  const scroller = document.createElement('div');
  scroller.className = 'MuiTabs-scroller';
  Object.defineProperty(scroller, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(scroller, 'clientWidth', { value: clientWidth, configurable: true });
  root.appendChild(scroller);
  document.body.appendChild(root);
  const detach = attachTabWheelScroll(root);
  return { root, scroller, detach };
};

const wheel = (root: HTMLElement, init: WheelEventInit) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  root.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('horizontalWheelDelta', () => {
  it('uses the vertical delta of a mouse wheel', () => {
    expect(horizontalWheelDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 500)).toBe(100);
  });

  it('uses the horizontal delta of a sideways swipe', () => {
    expect(horizontalWheelDelta({ deltaX: -40, deltaY: 5, deltaMode: 0 }, 500)).toBe(-40);
  });

  it('converts lines and pages to pixels', () => {
    expect(horizontalWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 500)).toBe(48);
    expect(horizontalWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 500)).toBe(500);
  });
});

describe('attachTabWheelScroll', () => {
  it('scrolls the tabs sideways with the wheel and keeps the page still', () => {
    const { root, scroller } = build({ scrollWidth: 1000, clientWidth: 400 });

    const down = wheel(root, { deltaY: 120 });
    expect(scroller.scrollLeft).toBe(120);
    expect(down.defaultPrevented).toBe(true);

    wheel(root, { deltaY: -50 });
    expect(scroller.scrollLeft).toBe(70);
  });

  it('stops at both ends and lets the event through there', () => {
    const { root, scroller } = build({ scrollWidth: 1000, clientWidth: 400 });

    const atStart = wheel(root, { deltaY: -100 });
    expect(scroller.scrollLeft).toBe(0);
    expect(atStart.defaultPrevented).toBe(false);

    wheel(root, { deltaY: 5000 });
    expect(scroller.scrollLeft).toBe(600);
    const atEnd = wheel(root, { deltaY: 100 });
    expect(scroller.scrollLeft).toBe(600);
    expect(atEnd.defaultPrevented).toBe(false);
  });

  it('leaves the wheel alone when every tab fits', () => {
    const { root, scroller } = build({ scrollWidth: 400, clientWidth: 400 });

    const event = wheel(root, { deltaY: 100 });
    expect(scroller.scrollLeft).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores a zoom gesture', () => {
    const { root, scroller } = build({ scrollWidth: 1000, clientWidth: 400 });

    const event = wheel(root, { deltaY: 100, ctrlKey: true });
    expect(scroller.scrollLeft).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops listening once detached', () => {
    const { root, scroller, detach } = build({ scrollWidth: 1000, clientWidth: 400 });
    detach();

    wheel(root, { deltaY: 100 });
    expect(scroller.scrollLeft).toBe(0);
  });
});
