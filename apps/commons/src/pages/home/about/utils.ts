import * as de from '@src/content/about/de.mdx';
import * as en from '@src/content/about/en.mdx';
import * as fr from '@src/content/about/fr.mdx';
import { Locales } from '@src/i18n';
import type { MDXProps } from 'mdx/types';
import type { ComponentType } from 'react';
import { ProfileProps } from './team-profile';

interface AboutFrontmatter {
  team?: ProfileProps[];
  [key: string]: unknown;
}

// Static mapping of content by locale. Keyed on `Locales`, so it must stay total:
// `getAboutContent` is consumed as `data.content` / `data.frontmatter` with no
// undefined guard, and a missing key would throw rather than degrade.
// `zh-Hant` and `ja` have no about page of their own yet and fall back to the
// English one, matching i18next's own `fallbackLng`. Swap in `zh-Hant.mdx` /
// `ja.mdx` when they are written.
// Content also exists for es/pt/ro, but none of those are in `locales` — they are
// unreachable until that list grows, so they are deliberately not mapped here.
const aboutContentMap: Record<
  Locales,
  { content: ComponentType<MDXProps>; frontmatter: AboutFrontmatter }
> = {
  de: { content: de.default, frontmatter: de.frontmatter },
  en: { content: en.default, frontmatter: en.frontmatter },
  fr: { content: fr.default, frontmatter: fr.frontmatter },
  'zh-Hant': { content: en.default, frontmatter: en.frontmatter },
  ja: { content: en.default, frontmatter: en.frontmatter },
};

export const getAboutContent = (locale: Locales) => {
  return aboutContentMap[locale];
};
