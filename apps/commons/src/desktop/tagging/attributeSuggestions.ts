import type { NodeDetail } from '@cwrc/leafwriter-validator';
import type { TagUsageStats } from './tagStats';
import { getAttrValueCounts, getProjectAttrCounts } from './tagStats';
import { getSchemaIdAttributeName, normalizeAttributeNameForSchema } from './attributeIdHelpers';
import { isEditableAttributeName } from './reservedAttributes';

export interface SchemaAttributeDetail {
  name: string;
  fullName?: string;
  invalid?: boolean;
  required?: boolean;
  choices?: string[];
  documentation?: string;
}

const getWriter = () => window.writer;

/** Schema paths are context-sensitive, but sibling indexes do not change which attributes apply. */
export const schemaAttributeContextKey = (tagName: string, xpath?: string | null): string =>
  `${tagName}\0${xpath?.replace(/\[\d+\]/g, '') ?? ''}`;

const toSchemaAttribute = (
  node: NodeDetail | Record<string, unknown>,
): SchemaAttributeDetail | null => {
  const rawName = (node as NodeDetail).name ?? (node as { name?: string }).name;
  if (!rawName) return null;

  const name = normalizeAttributeNameForSchema(rawName);
  if (!isEditableAttributeName(name)) return null;
  return {
    name,
    fullName: (node as NodeDetail).fullName ?? (node as { fullName?: string }).fullName,
    invalid: Boolean((node as NodeDetail).invalid),
    required: Boolean((node as { required?: boolean }).required),
    choices: (node as { choices?: string[] }).choices,
    documentation:
      (node as NodeDetail).documentation ?? (node as { documentation?: string }).documentation,
  };
};

/** Lower rank = better match when filtering attribute names. */
export const attributeNameMatchRank = (name: string, query: string): number => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return 50;

  const n = name.toLowerCase();
  if (n === trimmed) return 0;
  if (n.startsWith(trimmed)) return 1;
  if (n.endsWith(`:${trimmed}`)) return 2;
  if (n.includes(`:${trimmed}`)) return 3;
  if (n.endsWith(trimmed)) return 4;
  const index = n.indexOf(trimmed);
  if (index >= 0) return 5 + index / Math.max(n.length, 1);
  return 100;
};

export const orderAttributeSuggestions = (
  attrs: SchemaAttributeDetail[],
  tagName: string,
  stats: TagUsageStats | null | undefined,
  query: string,
): SchemaAttributeDetail[] => {
  const counts = stats ? getProjectAttrCounts(stats, tagName) : {};
  return [...attrs].sort((a, b) => {
    const aInvalid = Boolean(a.invalid);
    const bInvalid = Boolean(b.invalid);
    if (aInvalid !== bInvalid) return aInvalid ? 1 : -1;

    const rankA = attributeNameMatchRank(a.name, query);
    const rankB = attributeNameMatchRank(b.name, query);
    if (rankA !== rankB) return rankA - rankB;

    const aCount = counts[a.name] ?? 0;
    const bCount = counts[b.name] ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    if (Boolean(a.required) !== Boolean(b.required)) return a.required ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
};

const schemaAttrsFromManager = (tagElement: Element): SchemaAttributeDetail[] => {
  const writer = getWriter();
  if (!writer?.schemaManager) return [];

  const tagName = tagElement.getAttribute('_tag') ?? '';
  const xpath = writer.utilities.getElementXPath(tagElement);
  const raw =
    (xpath ? writer.schemaManager.getAttributesForPath(xpath) : null) ??
    writer.schemaManager.getAttributesForTag(tagName) ??
    [];

  return (raw as Record<string, unknown>[])
    .map((att) => toSchemaAttribute(att))
    .filter((att): att is SchemaAttributeDetail => Boolean(att));
};

export const fetchSchemaAttributes = async (
  tagElement: Element,
): Promise<SchemaAttributeDetail[]> => {
  const writer = getWriter();
  const xpath = writer?.utilities.getElementXPath(tagElement);
  const validatorActions = writer?.overmindActions?.validator;

  if (xpath && validatorActions?.getAttributesForTagAt) {
    try {
      const nodes = await validatorActions.getAttributesForTagAt({ xpath, index: 1 });
      const fromValidator = (nodes ?? [])
        .filter((node: NodeDetail) => node.type === 'attribute')
        .map((node: NodeDetail) => toSchemaAttribute(node))
        .filter((att: SchemaAttributeDetail | null): att is SchemaAttributeDetail => Boolean(att));
      if (fromValidator.length > 0) return fromValidator;
    } catch {
      // fall through to schema manager
    }
  }

  return schemaAttrsFromManager(tagElement);
};

export const fetchSchemaAttributesForTag = async (
  tagName: string,
): Promise<SchemaAttributeDetail[]> => {
  const writer = getWriter();
  if (!writer?.schemaManager || !tagName) return [];

  const raw = writer.schemaManager.getAttributesForTag(tagName) ?? [];
  return (raw as Record<string, unknown>[])
    .map((att) => toSchemaAttribute(att))
    .filter((att): att is SchemaAttributeDetail => Boolean(att));
};

export const sortAttributeSuggestions = (
  attrs: SchemaAttributeDetail[],
  tagName: string,
  stats: TagUsageStats,
): SchemaAttributeDetail[] => orderAttributeSuggestions(attrs, tagName, stats, '');

export const filterAttributeSuggestions = (
  attrs: SchemaAttributeDetail[],
  query: string,
): SchemaAttributeDetail[] => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return attrs;
  return attrs.filter(
    (attr) =>
      attr.name.toLowerCase().includes(trimmed) || attr.fullName?.toLowerCase().includes(trimmed),
  );
};

/** Known values for an attribute: most-used in the project first, then the schema's choices. */
export const suggestAttributeValues = (
  tagName: string,
  attrName: string,
  stats: TagUsageStats,
  choices: string[] = [],
): string[] => {
  const fromStats = Object.entries(getAttrValueCounts(stats, tagName, attrName))
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value);
  return [...new Set([...fromStats, ...choices])];
};

/** Values matching what has been typed, those starting with it ahead of those merely containing it. */
export const rankAttributeValues = (values: string[], query: string): string[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return values;
  const starts: string[] = [];
  const contains: string[] = [];
  for (const value of values) {
    const lower = value.toLowerCase();
    if (lower.startsWith(needle)) starts.push(value);
    else if (lower.includes(needle)) contains.push(value);
  }
  return [...starts, ...contains];
};

/** Rows shown at once. Drawing thousands of rows (every xml:id or corresp in a project) is slow. */
export const MAX_VALUE_SUGGESTIONS = 50;

const lastAttributeByTag = new Map<string, string>();
let lastAttributeOverall: string | null = null;

export const rememberLastAttribute = (tagName: string, attrName: string): void => {
  lastAttributeByTag.set(tagName, attrName);
  lastAttributeOverall = attrName;
};

export const resetLastAttributeMemory = (): void => {
  lastAttributeByTag.clear();
  lastAttributeOverall = null;
};

/**
 * Attribute to offer pre-filled: the last one added on this kind of tag, otherwise the last
 * one added anywhere, as long as the schema allows it here.
 */
export const pickPrefillAttributeName = (
  attrs: SchemaAttributeDetail[],
  tagName: string,
): string | null => {
  const allowed = (name: string | null | undefined): name is string =>
    Boolean(name) && attrs.some((attr) => attr.name === name && !attr.invalid);
  const forTag = lastAttributeByTag.get(tagName);
  if (allowed(forTag)) return forTag;
  return allowed(lastAttributeOverall) ? lastAttributeOverall : null;
};

export const resolveAttributeNameForApply = (
  attrs: SchemaAttributeDetail[],
  nameFilter: string,
  highlighted: SchemaAttributeDetail | null,
): SchemaAttributeDetail | null => {
  if (highlighted && !highlighted.invalid) return highlighted;

  const trimmed = nameFilter.trim();
  if (!trimmed) return null;

  const schemaId = getSchemaIdAttributeName();
  const canonical = normalizeAttributeNameForSchema(trimmed);

  const exact = attrs.find((attr) => attr.name === canonical && !attr.invalid);
  if (exact) return exact;

  if (trimmed === 'id' || canonical === schemaId) {
    const schemaIdAttr = attrs.find((attr) => attr.name === schemaId && !attr.invalid);
    if (schemaIdAttr) return schemaIdAttr;
  }

  if (isEditableAttributeName(canonical)) {
    return { name: canonical };
  }
  return null;
};
