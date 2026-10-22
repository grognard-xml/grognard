import { render } from '@testing-library/react';
import { DocumentTabBar } from './DocumentTabBar';

jest.mock('@src/overmind', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({
    filePath: `/p/${name}.xml`,
    filename: `${name}.xml`,
    dirty: false,
  }));
  const state = {
    project: { activeTabPath: '/p/a.xml', openTabs: tabs },
    editor: { contentHasChanged: false },
  };
  const actions = {
    project: { closeTab: jest.fn(), promptCloseDirtyTab: jest.fn(), switchTab: jest.fn() },
  };
  return { useAppState: () => state, useActions: () => actions };
});

describe('DocumentTabBar wheel scrolling', () => {
  it('scrolls the row of tabs sideways when the wheel turns over a tab', () => {
    const { container } = render(<DocumentTabBar />);
    const scroller = container.querySelector('.MuiTabs-scroller') as HTMLElement;
    expect(scroller).not.toBeNull();
    Object.defineProperty(scroller, 'scrollWidth', { value: 900, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 300, configurable: true });

    const tab = container.querySelector('[role="tab"]') as HTMLElement;
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 90 });
    tab.dispatchEvent(event);

    expect(scroller.scrollLeft).toBe(90);
    expect(event.defaultPrevented).toBe(true);
  });
});
