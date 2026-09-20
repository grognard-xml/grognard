import ForumIcon from '@mui/icons-material/Forum';
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ViewStreamOutlinedIcon from '@mui/icons-material/ViewStreamOutlined';
import ViewWeekOutlinedIcon from '@mui/icons-material/ViewWeekOutlined';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import BlockIcon from '@mui/icons-material/Block';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import CheckIcon from '@mui/icons-material/Check';
import ClearIcon from '@mui/icons-material/Clear';
import CloseIcon from '@mui/icons-material/Close';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import ComputerIcon from '@mui/icons-material/Computer';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import EditIcon from '@mui/icons-material/Edit';
import EventIcon from '@mui/icons-material/Event';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import FormatQuoteOutlinedIcon from '@mui/icons-material/FormatQuoteOutlined';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import GitHubIcon from '@mui/icons-material/GitHub';
import HelpCenterIcon from '@mui/icons-material/HelpCenter';
import HistoryIcon from '@mui/icons-material/History';
import LabelImportantRoundedIcon from '@mui/icons-material/LabelImportantRounded';
import LabelRoundedIcon from '@mui/icons-material/LabelRounded';
import LayersIcon from '@mui/icons-material/Layers';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import MergeRoundedIcon from '@mui/icons-material/MergeRounded';
import PanoramaFishEyeIcon from '@mui/icons-material/PanoramaFishEye';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import PeopleOutlineOutlinedIcon from '@mui/icons-material/PeopleOutlineOutlined';
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import PlaceIcon from '@mui/icons-material/Place';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import PrivacyTipOutlinedIcon from '@mui/icons-material/PrivacyTipOutlined';
import QuizRoundedIcon from '@mui/icons-material/QuizRounded';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SearchIcon from '@mui/icons-material/Search';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import ShortTextIcon from '@mui/icons-material/ShortText';
import StickyNote2Icon from '@mui/icons-material/StickyNote2';
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import StreamIcon from '@mui/icons-material/Stream';
import StyleOutlinedIcon from '@mui/icons-material/StyleOutlined';
import TagRoundedIcon from '@mui/icons-material/TagRounded';
import TranslateRoundedIcon from '@mui/icons-material/TranslateRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import CloudSyncOutlineIcon from 'mdi-material-ui/CloudSyncOutline';
import DotsCircleIcon from 'mdi-material-ui/DotsCircle';
import GitlabIcon from 'mdi-material-ui/Gitlab';
import LabelMultipleOutlineIcon from 'mdi-material-ui/LabelMultipleOutline';
import LabelVariantOutlineIcon from 'mdi-material-ui/LabelVariantOutline';
import OrderAlphabeticalAscendingIcon from 'mdi-material-ui/OrderAlphabeticalAscending';
import PlaylistCheckIcon from 'mdi-material-ui/PlaylistCheck';
import ShuffleVariantIcon from 'mdi-material-ui/ShuffleVariant';
import TagPlusIcon from 'mdi-material-ui/TagPlus';
import { Box, SvgIcon, type SvgIconProps, type SxProps, type Theme } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { useAppState } from '../overmind';

import { BookIcon, BookOutlinedIcon } from './custom/Book';
import { DisambiguateIcon } from './custom/Disambiguate';
import { BoxIcon, BoxOutlinedIcon } from './custom/BoxOpen';
import workIcon from './svg/book-solid.svg';
import thingIcon from './svg/box-open-solid.svg';
import iconCitation from './svg/citation.svg';
import validateIcon from './svg/clipboard-check-solid.svg';
import codeIcon from './svg/code-solid.svg';
import editIcon from './svg/edit-solid.svg';
import EventIconSVG from './svg/event.svg';
import markupFileIcon from './svg/file-code-solid.svg';
import loadIcon from './svg/folder-open-solid.svg';
import KeyIcon from './svg/key.svg';
import LabelIcon from './svg/label.svg';
import LinkIcon from './svg/link.svg';
import iconPerson from './svg/person.svg';
import PlaceIconSVG from './svg/place.svg';
import relationIcon from './svg/project-diagram-solid.svg';
import saveIcon from './svg/save-solid.svg';
import signOutIcon from './svg/sign-out-alt-solid.svg';
import NoteIcon from './svg/sticky-note.svg';
import tagEditIcon from './svg/tag-edit-solid.svg';
import tagRemoveIcon from './svg/tag-remove-solid.svg';
import TranslationIcon from './svg/translate.svg';
import triangleExclamationIcon from './svg/triangle-exclamation-solid.svg';
import iconOrg from './svg/users-solid.svg';
import toolCorrection from '../../../../apps/commons/src/icons/tool_correction.png';
import toolCorrectionDark from '../../../../apps/commons/src/icons/tool_correction.dark.png';
import toolHideNotes from '../../../../apps/commons/src/icons/tool_hide_notes.png';
import toolHideNotesDark from '../../../../apps/commons/src/icons/tool_hide_notes.dark.png';
import toolShowNotes from '../../../../apps/commons/src/icons/tool_show_notes.png';
import toolShowNotesDark from '../../../../apps/commons/src/icons/tool_show_notes.dark.png';
import toolTransform from '../../../../apps/commons/src/icons/tool_transform.png';
import toolTransformDark from '../../../../apps/commons/src/icons/tool_transform.dark.png';
import krpMenu from '../../../../apps/commons/src/icons/krp_menu.png';
import krpMenuDark from '../../../../apps/commons/src/icons/krp_menu.dark.png';
import menuNorbert from '../../../../apps/commons/src/icons/menu_norbert.png';
import menuNorbertDark from '../../../../apps/commons/src/icons/menu_norbert.dark.png';
import menuStructure from '../../../../apps/commons/src/icons/menu_structure.png';
import menuStructureDark from '../../../../apps/commons/src/icons/menu_structure.dark.png';
import pluginChhiv from '../../../../apps/commons/src/icons/plugin-CHHIV.png';
import pluginChhivDark from '../../../../apps/commons/src/icons/plugin-CHHIV.dark.png';

export { BookIcon, BookOutlinedIcon } from './custom/Book';
export { DisambiguateIcon } from './custom/Disambiguate';
export { BoxIcon, BoxOutlinedIcon } from './custom/BoxOpen';

const themedToolIcon = (light: string, dark: string) => {
  const ToolIcon = ({ sx, className }: { className?: string; sx?: SxProps<Theme> }) => {
    const { mode, systemMode } = useColorScheme();
    const { darkMode } = useAppState().ui;
    const isDark = darkMode || mode === 'dark' || (mode === 'system' && systemMode === 'dark');

    return (
      <Box
        component="img"
        aria-hidden
        className={className}
        src={isDark ? dark : light}
        alt=""
        sx={{
          display: 'block',
          width: '1em',
          height: '1em',
          objectFit: 'contain',
          ...sx,
        }}
      />
    );
  };

  return ToolIcon;
};

const toolCorrectionIcon = themedToolIcon(toolCorrection, toolCorrectionDark);
const toolHideNotesIcon = themedToolIcon(toolHideNotes, toolHideNotesDark);
const toolShowNotesIcon = themedToolIcon(toolShowNotes, toolShowNotesDark);
const toolTransformIcon = themedToolIcon(toolTransform, toolTransformDark);
const kanripoMenuIcon = themedToolIcon(krpMenu, krpMenuDark);
const norbertMenuIcon = themedToolIcon(menuNorbert, menuNorbertDark);
const structureMenuIcon = themedToolIcon(menuStructure, menuStructureDark);
const chhivMenuIcon = themedToolIcon(pluginChhiv, pluginChhivDark);

const icons = {
  accept: CheckIcon,
  add: AddCircleOutlineIcon,
  arrowDownwardIcon: ArrowDownwardIcon,
  arrowForwardIosIcon: ArrowForwardIosIcon,
  autoFixHigh: AutoFixHighIcon,
  block: BlockIcon,
  BookIcon: BookIcon,
  BookOutlinedIcon: BookOutlinedIcon,
  BoxIcon: BoxIcon,
  BoxOutlinedIcon: BoxOutlinedIcon,
  lock: LockIcon,
  lockOpen: LockOpenIcon,
  change: ReplayIcon,
  checkIcon: CheckIcon,
  citation: FormatQuoteIcon,
  citationDraft: FormatQuoteOutlinedIcon,
  ClearIcon: ClearIcon,
  close: CloseIcon,
  CloseIcon: CloseIcon,
  cloud: CloudQueueIcon,
  cloudSync: CloudSyncOutlineIcon,
  code: CodeRoundedIcon,
  CodeRoundedIcon: CodeRoundedIcon,
  computer: ComputerIcon,
  concept: ForumIcon,
  copy: ContentCopyIcon,
  correction: WarningRoundedIcon,
  toolCorrection: toolCorrectionIcon,
  date: EventIcon,
  delete: ClearIcon,
  disambiguate: DisambiguateIcon,
  documentation: QuizRoundedIcon,
  DotsCircle: DotsCircleIcon,
  draft: DotsCircleIcon,
  dragAndDrop: ShuffleVariantIcon,
  edit: EditIcon,
  entities: StreamIcon,
  entitiesTag: StyleOutlinedIcon,
  EventIcon: EventIcon,
  findReplace: FindReplaceIcon,
  fingerprint: FingerprintIcon,
  FormatQuoteIcon: FormatQuoteIcon,
  FormatQuoteOutlinedIcon: FormatQuoteOutlinedIcon,
  fullscreen: FullscreenRoundedIcon,
  fullscreenExit: FullscreenExitRoundedIcon,
  FullscreenExitRoundedIcon: FullscreenExitRoundedIcon,
  FullscreenRoundedIcon: FullscreenRoundedIcon,
  github: GitHubIcon,
  gitlab: GitlabIcon,
  HelpCenterIcon: HelpCenterIcon,
  history: HistoryIcon,
  imageViewer: PhotoLibraryRoundedIcon,
  insertTag: TagPlusIcon,
  invalid: WarningAmberRoundedIcon,
  kanripo: kanripoMenuIcon,
  norbertMenu: norbertMenuIcon,
  keyword: VpnKeyRoundedIcon,
  LabelImportantRoundedIcon: LabelImportantRoundedIcon,
  LabelRoundedIcon: LabelRoundedIcon,
  LabelVariantOutline: LabelVariantOutlineIcon,
  layers: LayersIcon,
  link: LinkRoundedIcon,
  LinkRoundedIcon: LinkRoundedIcon,
  merge: MergeRoundedIcon,
  MergeRoundedIcon: MergeRoundedIcon,
  note: StickyNote2Icon,
  office: AccountTreeRoundedIcon,
  OrderAlphabeticalAscending: OrderAlphabeticalAscendingIcon,
  organization: PeopleAltIcon,
  organizationDraft: PeopleOutlineOutlinedIcon,
  PanoramaFishEyeIcon: PanoramaFishEyeIcon,
  paste: ContentPasteIcon,
  PeopleAltIcon: PeopleAltIcon,
  PeopleOutlineOutlinedIcon: PeopleOutlineOutlinedIcon,
  person: PersonOutlineOutlinedIcon,
  personDraft: PersonOutlineOutlinedIcon,
  PersonIcon: PersonOutlineOutlinedIcon,
  PersonOutlineOutlinedIcon: PersonOutlineOutlinedIcon,
  place: PlaceIcon,
  placeDraft: PlaceOutlinedIcon,
  PlaceIcon: PlaceIcon,
  PlaceOutlinedIcon: PlaceOutlinedIcon,
  PlaylistCheck: PlaylistCheckIcon,
  Privacy: PrivacyTipOutlinedIcon,
  QuizRoundedIcon: QuizRoundedIcon,
  reject: ClearIcon,
  remove: RemoveCircleOutlineIcon,
  ReplayIcon: ReplayIcon,
  reset: RestartAltIcon,
  settings: SettingsRoundedIcon,
  SettingsRoundedIcon: SettingsRoundedIcon,
  shortText: ShortTextIcon,
  showTagsOff: LabelVariantOutlineIcon,
  showTagsOn: LabelImportantRoundedIcon,
  showBreaksOff: ViewStreamOutlinedIcon,
  showBreaksOn: ViewWeekOutlinedIcon,
  showNotesOff: StickyNote2OutlinedIcon,
  showNotesOn: StickyNote2Icon,
  toolHideNotes: toolHideNotesIcon,
  toolShowNotes: toolShowNotesIcon,
  ShuffleVariant: ShuffleVariantIcon,
  sortAlphabetically: OrderAlphabeticalAscendingIcon,
  sortLinear: ArrowDownwardIcon,
  sortType: LabelRoundedIcon,
  split: CallSplitIcon,
  StickyNote2Icon: StickyNote2Icon,
  structure: structureMenuIcon,
  chhiv: chhivMenuIcon,
  tagMultiSelection: LabelMultipleOutlineIcon,
  toolTransform: toolTransformIcon,
  TagPlus: TagPlusIcon,
  TagRoundedIcon: TagRoundedIcon,
  tags: LabelRoundedIcon,
  textNode: TagRoundedIcon,
  thing: BoxIcon,
  thingDraft: BoxOutlinedIcon,
  work: BookIcon,
  workDraft: BookOutlinedIcon,
  xpathSearch: SearchIcon,
  toc: FormatListBulletedIcon,
  translate: TranslateRoundedIcon,
  TranslateRoundedIcon: TranslateRoundedIcon,
  unknown: HelpCenterIcon,
  validate: PlaylistCheckIcon,
  vetted: PanoramaFishEyeIcon,
  VpnKeyRoundedIcon: VpnKeyRoundedIcon,
  WarningRoundedIcon: WarningRoundedIcon,
  xmlViewer: CodeRoundedIcon,
};

export type IconLeafWriter = keyof typeof icons;

export const getIcon = (name: IconLeafWriter): NonNullable<SvgIconProps['component']> =>
  icons[name] as NonNullable<SvgIconProps['component']>;

export interface IconProps extends SvgIconProps {
  name: IconLeafWriter;
}

export const Icon = (props: IconProps) => {
  const { name, ...rest } = props;
  const icon = icons[name];
  return <SvgIcon component={icon} {...rest} />;
};

const svgs = new Map([
  ['tags', LabelIcon],
  ['person', iconPerson],
  ['place', PlaceIconSVG],
  ['work', workIcon],
  ['date', EventIconSVG],
  ['organization', iconOrg],
  ['citation', iconCitation],
  ['note', NoteIcon],
  ['correction', triangleExclamationIcon],
  ['keyword', KeyIcon],
  ['link', LinkIcon],
  ['thing', thingIcon],
  ['translation', TranslationIcon],
  ['relation', relationIcon],
  ['tag-edit', tagEditIcon],
  ['tag-remove', tagRemoveIcon],
  ['code', codeIcon],
  ['markup-file', markupFileIcon],
  ['edit', editIcon],
  ['validate', validateIcon],
  ['save', saveIcon],
  ['load', loadIcon],
  ['sign-out', signOutIcon],
]);

export const getSvg = (name: string) => {
  const icon = svgs.get(name);
  if (!icon) return LabelIcon;
  return icon;
};
