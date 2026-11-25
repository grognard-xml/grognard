/**
 * Components-tab catalogue for Compose (marinaMoji parity Phase 2).
 * Common radicals by stroke count, zi.tools “difficult” components, radical
 * positional variants, and a built-in first-stroke class table (橫豎撇點折).
 * Ported from marinaMoji character_composer_dialog.cc / ids_table.cc (BSD).
 */

export type FirstStrokeClass = 1 | 2 | 3 | 4 | 5;

export const FIRST_STROKE_LABELS: { class: FirstStrokeClass; glyph: string; tip: string }[] = [
  { class: 1, glyph: '一', tip: 'horizontal 一' },
  { class: 2, glyph: '丨', tip: 'vertical 丨' },
  { class: 3, glyph: '丿', tip: 'left-falling 丿' },
  { class: 4, glyph: '丶', tip: 'dot 丶' },
  { class: 5, glyph: '乛', tip: 'turning 乛' },
];

/** Positional forms hidden when “Radical variants” is off. */
export const RADICAL_VARIANT_FORMS = new Set(Array.from('亻𠆢刂忄扌氵犭礻衤⺮耂灬'));

interface CommonGroup {
  strokes: number;
  components: string;
}
interface HardGroup {
  strokes: number;
  lead: FirstStrokeClass;
  components: string;
}

const COMMON_GROUPS: CommonGroup[] = [
  { strokes: 1, components: '一丨丿丶乙亅' },
  { strokes: 2, components: '二亠人亻𠆢儿入八冂冖冫几凵刀刂力勹匕匚十卜卩厂厶又廴' },
  { strokes: 3, components: '口囗土士夂夕大女子宀寸小尸山川工己巾干广弓彡彳忄扌氵犭艹辶阝' },
  { strokes: 4, components: '心戈戸手支攵文斗斤方日曰月木欠止歹殳毋比毛氏水火灬爪父片牛犬王礻耂' },
  { strokes: 5, components: '玄瓦甘生用田疋疒白皮皿目矛矢石示禾穴立衤' },
  { strokes: 6, components: '竹⺮米糸缶羊羽老而耳聿肉臣自至舌舟艮色虍虫血行衣西' },
  { strokes: 7, components: '見角言谷豆豕貝赤走足身車辛辰酉里' },
  { strokes: 8, components: '金長門隹雨青非' },
  { strokes: 9, components: '面革音頁風飛食首香骨鬼' },
  { strokes: 10, components: '馬高髟' },
  { strokes: 11, components: '魚鳥鹿麻黄黒' },
  { strokes: 14, components: '鼻' },
  { strokes: 16, components: '龍' },
];

const HARD_GROUPS: HardGroup[] = [
  { strokes: 1, lead: 4, components: '乀' },
  { strokes: 1, lead: 5, components: '乛𠃍𠃌㇇㇈𠄎㇁乚𠃊㇄𠄌𠃑㇉𠃋𡿨㇂' },
  { strokes: 2, lead: 1, components: '丅𬺰丆𠂇丂匸𠀁𫠠' },
  { strokes: 2, lead: 2, components: '⺊丄𠃎〢リ' },
  { strokes: 2, lead: 3, components: '𠂉𰀪𠂆乂㐅⺈𠂊𠤎⺆' },
  { strokes: 2, lead: 4, components: '丷𬼀⺀讠' },
  { strokes: 2, lead: 5, components: 'コユ𰆊丩𠂈龴㔾巜𢎘' },
  { strokes: 3, lead: 1, components: '亍𰀁𰀄亐卄𰀃廾尢𠆣𬺢夨㐄𠫓𠫔𡕒' },
  { strokes: 3, lead: 2, components: '〣𡭔𰀠𣥂⺌𠔼𠀃' },
  { strokes: 3, lead: 3, components: '乇𫶧𰃦𠂋亼亽𠓛饣夊亇𠂎𠚤𱍸' },
  { strokes: 3, lead: 4, components: '丬䒑𭕄' },
  { strokes: 3, lead: 5, components: '𫜹⺕彐卂卪屮𠃓亾乆彑𫝀纟巛' },
  { strokes: 4, lead: 1, components: '龶龷卝廿𠮛帀朩𡭕丏厷旡𢆰' },
  { strokes: 4, lead: 2, components: '攴龰𰀡𠔿⺝冄冃𫩏𦉪禸𦉫𠁣' },
  { strokes: 4, lead: 3, components: '壬𡈼龵𠂒丯爫爻仌尣仒⺼𧘇𠂔厃卬卆𱼀' },
  { strokes: 4, lead: 4, components: '冘㓁' },
  { strokes: 4, lead: 5, components: '夬肀弔𢀳𠃜丮𠬝爿㞢刅𠬞丱㣺厸' },
  { strokes: 5, lead: 1, components: '𠀎𡗗戋𰀉𫇦𣄼圥朮𤴓卌𪩲犮戊𡗜𬺻戉' },
  { strokes: 5, lead: 2, components: '歺丗龸罒冋曳𠕁龱𪠲𠀐𦉰囙𮍌' },
  { strokes: 5, lead: 3, components: '钅㐌㐱尒㕣氐卯夗刍𠂡夘𬼉' },
  { strokes: 5, lead: 4, components: '𢆉宂𰃮' },
  { strokes: 5, lead: 5, components: '㠯㞋𡰪氶𤴔癶𢀖𠬤氺弁' },
  { strokes: 6, lead: 1, components: '耒幵㓞覀𢦏朿襾巩𤰔㐁𠀠' },
  { strokes: 6, lead: 2, components: '尗吅𠕋' },
  { strokes: 6, lead: 3, components: '𥫗𦥑𠂤囟甶𠂢𧰨乑𠇍𠂭𠫤舛𪧷夅𫥞' },
  { strokes: 6, lead: 4, components: '𭤨㐫𣅀𰁜龹𦍌屰' },
  { strokes: 6, lead: 5, components: '帇𢑑艸劦叒䏍厽𢆶' },
  { strokes: 7, lead: 1, components: '孛𦣞𦔮耴𡉵𢦒尨𦣻丣巠𫠩' },
  { strokes: 7, lead: 2, components: '镸𣦼𧾷邑肙圼冏囧甹' },
  { strokes: 7, lead: 3, components: '𦈢𭻾攸䖝𦥔皃豸釆寽佥夆' },
  { strokes: 7, lead: 4, components: '㐬' },
  { strokes: 7, lead: 5, components: '𠬶𠃬戼夋矣𣧄' },
  { strokes: 8, lead: 1, components: '忝枼夌𦭝𠦝臤坴亟叀𣏟豖㚔𡘆戔疌' },
  { strokes: 8, lead: 2, components: '卥㡀𫩠咼㝵畀冐𦙃' },
  { strokes: 8, lead: 3, components: '𥝢臾𨸏阜飠𠈌忩㸚㸒㑒㦰臽匊匋' },
  { strokes: 8, lead: 4, components: '咅𣏋㐭斉㫄罙𢼄' },
  { strokes: 8, lead: 5, components: '𡬠叕沓㣇甾' },
  { strokes: 9, lead: 1, components: '畐壴垔荅㪅𠀷耎𲺋' },
  { strokes: 9, lead: 2, components: '𠧪曷昜禺昷耑咢咠𬙙' },
  { strokes: 9, lead: 3, components: '臿叟禹𣬉爰弇爯矦㲋' },
  { strokes: 9, lead: 4, components: '㒸叜' },
  { strokes: 9, lead: 5, components: '叚𢏚凾芔癸㚇彖𡿺𩠐' },
  { strokes: 10, lead: 1, components: '冓尃㱿𤰇𡘤' },
  { strokes: 10, lead: 2, components: '丵𧴪𦐇眔畟' },
  { strokes: 10, lead: 3, components: '𠂹皋虒䍃奚芻𰮤' },
  { strokes: 10, lead: 4, components: '竜𤇾𡨄隺冡' },
  { strokes: 10, lead: 5, components: '圅鬯𣁋' },
  { strokes: 11, lead: 1, components: '𠩺殸堇㒼埶𦰩桼䙴𢛳殹𮍏' },
  { strokes: 11, lead: 2, components: '虘虖啚𠁁' },
  { strokes: 11, lead: 3, components: '𬀷皐悤𣶒𡕩' },
  { strokes: 11, lead: 4, components: '啇羕' },
  { strokes: 11, lead: 5, components: '翏㕘' },
  { strokes: 12, lead: 1, components: '賁棥尞𦓔厤畱朁' },
  { strokes: 12, lead: 2, components: '菐黹戢𢽠' },
  { strokes: 12, lead: 3, components: '𡍮敫雋衆舄翕㫺𤔔𦥯' },
  { strokes: 12, lead: 4, components: '戠𰕎' },
  { strokes: 12, lead: 5, components: '叅' },
  { strokes: 13, lead: 1, components: '畺𣪠' },
  { strokes: 13, lead: 2, components: '豦喿睘睪𥇡豊' },
  { strokes: 13, lead: 3, components: '僉' },
  { strokes: 13, lead: 4, components: '亶𣎆稟廌' },
  { strokes: 13, lead: 5, components: '𡕰' },
  { strokes: 14, lead: 1, components: '皷𰯲𡏳臧' },
  { strokes: 14, lead: 2, components: '㬎' },
  { strokes: 14, lead: 3, components: '㥯夐' },
  { strokes: 14, lead: 4, components: '賔' },
  { strokes: 14, lead: 5, components: '㡭' },
  { strokes: 15, lead: 1, components: '賛奭𧶠韯' },
  { strokes: 15, lead: 2, components: '畾嶲瞏' },
  { strokes: 15, lead: 3, components: '臱䝿𢀩' },
  { strokes: 15, lead: 4, components: '廛𦎫𦎧𬴘' },
  { strokes: 15, lead: 5, components: '巤' },
  { strokes: 16, lead: 1, components: '𤴡' },
  { strokes: 16, lead: 2, components: '鬳' },
  { strokes: 16, lead: 4, components: '褱𩫏' },
  { strokes: 17, lead: 1, components: '雚霝' },
  { strokes: 17, lead: 3, components: '龠韱毚' },
  { strokes: 17, lead: 4, components: '襄' },
  { strokes: 18, lead: 2, components: '巂瞿' },
  { strokes: 18, lead: 3, components: '𤐫' },
  { strokes: 19, lead: 1, components: '夒' },
  { strokes: 19, lead: 5, components: '䜌' },
  { strokes: 21, lead: 2, components: '𪉷' },
];

const LEADING_STROKE_GROUPS: { strokeClass: FirstStrokeClass; chars: string }[] = [
  {
    strokeClass: 1,
    chars:
      '一㇀二三十干于工土士王玉丰耒天夫开井未末正平五元云示下不丁七万丈与才寸大太犬木本戈弋甘其革酉西两而耳豆雨面百石厂匚廿世古可至互瓦牙尤巫亞来表事吏再丙頁夏東車辰走赤青束考老者耶戸臣支求豕甫夹奉春黄黃扌⺘𤣩耂⺹艹⺾车尢麦比甚巨歺戊戌𠦝',
  },
  {
    strokeClass: 2,
    chars:
      '丨口囗日曰目田由甲申电中虫冂上止卜山貝見只足皿罒⺫罓尚⺌黒里果骨四史央内吅品巾虍齒鹵业北非典曲少光当門刂⺉𧾷⻊黑⺊贝齿肉鬥占',
  },
  {
    strokeClass: 3,
    chars:
      '丿人亻⺅𠆢入八儿几九千川久夕勹匕斤爪⺤爫父片牛牜生失矢禾白自舌舟竹⺮𥫗臼血行彳金釒钅⻐食飠𩙿饣⻟魚鳥身角丘年午手毛气欠犭⺨月用風瓜采豸隹鬼香夂攵彡缶后垂重乎我免先及乏乍系鼠兵乘鼻⺈鱼𦥑𠂊谷𠂉㐅鸟每氏爻告朱杀與',
  },
  {
    strokeClass: 4,
    chars:
      '丶⺀亠冫氵⺡宀冖广疒立言訁讠⻈文方主火灬⺣米羊首关美义斗心忄⺖⺗必永市交亡六亥玄衣衤⻂礻⺭辶⻌⻍之户鹿麻高京齊门兑兰半并前益良卒帝音章竟产离亨龍⺍丷䒑𦍌龹䜌',
  },
  {
    strokeClass: 5,
    chars:
      '乙乚乛𠃌𠃊亅了子也习刀力又马弓己已巳尸尹卩阝⻖⻏凵厶幺糸糹纟⺯女母毋丑民艮水氺⺢小承予矛聿隶刃叉飞飛廴巛彐癶巴彑尺⺄',
  },
];

let hardLeadMap: Map<string, FirstStrokeClass> | null = null;
let builtinLeadMap: Map<string, FirstStrokeClass> | null = null;
let hardCharSet: Set<string> | null = null;

const hardLeads = (): Map<string, FirstStrokeClass> => {
  if (hardLeadMap) return hardLeadMap;
  hardLeadMap = new Map();
  hardCharSet = new Set();
  for (const group of HARD_GROUPS) {
    for (const ch of Array.from(group.components)) {
      hardLeadMap.set(ch, group.lead);
      hardCharSet!.add(ch);
    }
  }
  return hardLeadMap;
};

const builtinLeads = (): Map<string, FirstStrokeClass> => {
  if (builtinLeadMap) return builtinLeadMap;
  builtinLeadMap = new Map();
  for (const group of LEADING_STROKE_GROUPS) {
    for (const ch of Array.from(group.chars)) {
      if (!builtinLeadMap.has(ch)) builtinLeadMap.set(ch, group.strokeClass);
    }
  }
  return builtinLeadMap;
};

export const isDifficultComponent = (ch: string): boolean => {
  hardLeads();
  return hardCharSet!.has(ch);
};

/** First-stroke class 1–5, or 0 if unknown. */
export const leadingStrokeClass = (ch: string): number =>
  hardLeads().get(ch) ?? builtinLeads().get(ch) ?? 0;

export interface ComponentSection {
  strokes: number;
  components: string[];
}

export interface CatalogueFilters {
  showDifficult: boolean;
  showRadicalVariants: boolean;
  /** Empty = all; otherwise only these first-stroke classes. */
  firstStrokes: FirstStrokeClass[];
}

/**
 * Catalogue sections for the Components tab, with filters applied.
 * Common components come first within each stroke-count row; difficult ones
 * follow when enabled.
 */
export const buildComponentSections = (filters: CatalogueFilters): ComponentSection[] => {
  const byStrokes = new Map<number, string[]>();
  const push = (strokes: number, components: string, onlyHard: boolean) => {
    const list = byStrokes.get(strokes) ?? [];
    for (const ch of Array.from(components)) {
      if (!filters.showRadicalVariants && RADICAL_VARIANT_FORMS.has(ch)) continue;
      if (onlyHard && !filters.showDifficult) continue;
      if (!onlyHard && isDifficultComponent(ch)) continue;
      const lead = leadingStrokeClass(ch);
      if (
        filters.firstStrokes.length > 0 &&
        (lead === 0 || !filters.firstStrokes.includes(lead as FirstStrokeClass))
      ) {
        continue;
      }
      if (!list.includes(ch)) list.push(ch);
    }
    byStrokes.set(strokes, list);
  };

  for (const group of COMMON_GROUPS) push(group.strokes, group.components, false);
  for (const group of HARD_GROUPS) push(group.strokes, group.components, true);

  return [...byStrokes.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, components]) => components.length > 0)
    .map(([strokes, components]) => ({ strokes, components }));
};

export const flattenShownComponents = (filters: CatalogueFilters): string[] =>
  buildComponentSections(filters).flatMap((section) => section.components);

/**
 * Toggle a component glyph in the Find field text (keep stroke filters).
 * Port of marinaMoji OnComponentToggled.
 */
export const toggleComponentInFindText = (findText: string, component: string): string => {
  if (findText.includes(component)) {
    return findText.split(component).join('').replace(/\s+/g, ' ').trim();
  }
  const trimmed = findText.trim();
  return trimmed ? `${trimmed} ${component}` : component;
};
