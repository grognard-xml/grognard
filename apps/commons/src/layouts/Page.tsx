import { useAppState } from '@src/overmind';
import { isDesktop } from '@src/types/desktop';
import { forwardRef, useEffect, type HTMLAttributes } from 'react';
import { Helmet } from 'react-helmet-async';

interface PageProps {
  title?: string;
}

const WEB_PAGE_TITLE = 'LEAF-Writer Commons';
const DESKTOP_PAGE_TITLE = 'Grognard';

// The ref and the remaining props go to a plain div; callers pass arbitrary div attributes.
export const Page = forwardRef<HTMLDivElement, PageProps & HTMLAttributes<HTMLDivElement>>(
  ({ children, title, ...rest }, ref) => {
    const { resource } = useAppState().editor;

    const appTitle = isDesktop() ? DESKTOP_PAGE_TITLE : WEB_PAGE_TITLE;
    title = title ?? appTitle;
    title = resource?.filename ? `${resource.filename} — ${appTitle}` : title;

    useEffect(() => {
      if (isDesktop()) {
        void window.electronAPI?.setWindowTitle(title);
      }
    }, [title]);

    return (
      <div ref={ref} {...rest}>
        <Helmet>
          <title>{title}</title>
          <meta
            name="description"
            content="The XML & RDF online editor of the Linked Editing Academic Framework"
          />
        </Helmet>
        <div>{children}</div>
      </div>
    );
  },
);
