import { reconcileGlyphDeclarations } from '@cwrc/leafwriter/glyphCharDecl';
import { findOrlandoHeader } from './orlandoHeaderXml';
import { DESKTOP_APP_DISPLAY_NAME, DESKTOP_APP_IDENT } from './desktopBranding';
import { isOrlandoCatalog } from './schemaMetadataFields';
import { findTeiHeader, hasTeiHeader, TEI_NS } from './teiHeaderXml';

/**
 * TEI `@version` on `application` must match:
 * `[\d]+[a-z]*[\d]*(\.[\d]+[a-z]*[\d]*){0,3}`
 * Semver prerelease tags like `0.1.0-beta.1` are invalid; keep the numeric core.
 */
export const toTeiApplicationVersion = (raw: string | undefined | null): string => {
  const trimmed = (raw ?? '').trim();
  const core = trimmed.split(/[-+]/, 2)[0]?.trim() ?? '';
  if (/^\d+[a-z]*\d*(\.\d+[a-z]*\d*){0,3}$/.test(core)) return core;
  return '0.1.0';
};

const findChildByLocalName = (parent: Element, name: string): Element | null => {
  for (const child of parent.children) {
    if (child.localName === name || child.tagName === name) return child;
  }
  return null;
};

const findTeiChild = (parent: Element, name: string): Element | null =>
  parent.getElementsByTagNameNS(TEI_NS, name)[0] ?? parent.getElementsByTagName(name)[0] ?? null;

const findTeiApplication = (appInfo: Element): Element | null => {
  const apps = [
    ...Array.from(appInfo.getElementsByTagNameNS(TEI_NS, 'application')),
    ...Array.from(appInfo.getElementsByTagName('application')),
  ];
  return apps.find((app) => app.getAttribute('ident') === DESKTOP_APP_IDENT) ?? null;
};

const stampTeiApplication = (application: Element, who: string, when: string, version: string) => {
  application.setAttribute('when', when);
  application.setAttribute('version', toTeiApplicationVersion(version));
  Array.from(application.childNodes).forEach((child) => {
    application.removeChild(child);
  });

  const label = application.ownerDocument!.createElementNS(TEI_NS, 'label');
  label.textContent = `${DESKTOP_APP_DISPLAY_NAME} (${who})`;
  application.appendChild(label);
};

const stampTeiLastSaved = (
  xml: string,
  encoderName: string,
  savedAt: Date,
  appVersion: string,
): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return xml;

  const header = findTeiHeader(doc);
  if (!header) return xml;

  const when = savedAt.toISOString().slice(0, 10);
  const who = encoderName.trim() || 'Unknown';

  let encodingDesc = findTeiChild(header, 'encodingDesc');
  if (!encodingDesc) {
    encodingDesc = doc.createElementNS(TEI_NS, 'encodingDesc');
    const fileDesc = findTeiChild(header, 'fileDesc');
    if (fileDesc?.nextSibling) {
      header.insertBefore(encodingDesc, fileDesc.nextSibling);
    } else {
      header.appendChild(encodingDesc);
    }
  }

  let appInfo = findTeiChild(encodingDesc, 'appInfo');
  if (!appInfo) {
    appInfo = doc.createElementNS(TEI_NS, 'appInfo');
    encodingDesc.appendChild(appInfo);
  }

  let application = findTeiApplication(appInfo);
  if (!application) {
    application = doc.createElementNS(TEI_NS, 'application');
    application.setAttribute('ident', DESKTOP_APP_IDENT);
    appInfo.appendChild(application);
  }

  stampTeiApplication(application, who, when, appVersion);

  return new XMLSerializer().serializeToString(doc);
};

const findOrlandoResponsibility = (revisionDesc: Element, resp: string): Element | null => {
  for (const child of revisionDesc.children) {
    if (child.localName !== 'RESPONSIBILITY' && child.tagName !== 'RESPONSIBILITY') continue;
    if (child.getAttribute('RESP') === resp) return child;
  }
  return null;
};

const stampOrlandoLastSaved = (xml: string, encoderName: string, savedAt: Date): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return xml;

  const header = findOrlandoHeader(doc);
  if (!header) return xml;

  const when = savedAt.toISOString().slice(0, 10);
  const who = encoderName.trim() || 'Unknown';

  let revisionDesc = findChildByLocalName(header, 'REVISIONDESC');
  if (!revisionDesc) {
    revisionDesc = doc.createElement('REVISIONDESC');
    header.appendChild(revisionDesc);
  }

  let responsibility = findOrlandoResponsibility(revisionDesc, DESKTOP_APP_DISPLAY_NAME);
  if (!responsibility) {
    responsibility = doc.createElement('RESPONSIBILITY');
    responsibility.setAttribute('RESP', DESKTOP_APP_DISPLAY_NAME);
    responsibility.setAttribute('WORKSTATUS', 'SUB');
    responsibility.setAttribute('WORKVALUE', 'I');
    revisionDesc.insertBefore(responsibility, revisionDesc.firstChild);
  }

  let date = findChildByLocalName(responsibility, 'DATE');
  if (!date) {
    date = doc.createElement('DATE');
    responsibility.appendChild(date);
  }
  date.setAttribute('when', when);
  date.textContent = who;

  return new XMLSerializer().serializeToString(doc);
};

export const stampLastEditedInXml = (
  xml: string,
  options: {
    catalogId?: string | null;
    encoderName?: string;
    savedAt?: Date;
    appVersion?: string;
  },
): string => {
  const savedAt = options.savedAt ?? new Date();
  const encoderName = options.encoderName ?? 'Unknown';

  if (isOrlandoCatalog(options.catalogId)) {
    return stampOrlandoLastSaved(xml, encoderName, savedAt);
  }

  if (!hasTeiHeader(xml)) return xml;

  return stampTeiLastSaved(xml, encoderName, savedAt, options.appVersion ?? '0.1.0');
};

export const stampContentBeforeSave = async (
  content: string,
  catalogId?: string | null,
): Promise<string> => {
  let encoderName = '';
  if (window.electronAPI?.getEncoderName) {
    try {
      encoderName = await window.electronAPI.getEncoderName();
    } catch {
      encoderName = '';
    }
  }

  let appVersion = '0.1.0';
  if (window.electronAPI?.getAppVersion) {
    try {
      appVersion = (await window.electronAPI.getAppVersion()) || appVersion;
    } catch {
      // keep fallback
    }
  }

  // Drop glyph declarations nothing uses any more (e.g. a deleted gaiji) -
  // see reconcileGlyphDeclarations for exactly what is and isn't touched.
  return stampLastEditedInXml(reconcileGlyphDeclarations(content), {
    catalogId,
    encoderName,
    appVersion,
  });
};
