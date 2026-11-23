import { getAppLocale } from './appLocale';

/**
 * Minimal string table for the Electron main process. Renderer i18next resources
 * aren't reachable here, so native dialog / progress strings that main.ts,
 * languageToolManaged.ts, and authorityLifecycle.ts show get their own small
 * locale-keyed table instead. Keep this in sync with the LWC.desktop.main_process.*
 * namespace conceptually, but it does not need to round-trip through i18next.
 */
const STRINGS = {
  en: {
    open_project_folder_title: 'Open project folder',
    entity_db_is_project_title: 'That folder is your entity database',
    entity_db_is_project_message:
      "This folder is configured as your entity database folder and can't be used as a project folder. Choose a different folder for your project.",
    ok: 'OK',
    open_project_failed_message: 'Could not open this project folder.',
    open_recent_project_failed_message: 'This recent project is no longer available.',
    choose_schema_file_title: 'Choose schema file (.rng)',
    choose_search_folder_title: 'Choose folder to search',
    choose_css_file_title: 'Choose CSS file (optional)',
    choose_css_file_message: 'Optional: choose a CSS file for this schema, or Cancel to skip.',
    import_documents_title: 'Import documents',
    import_documents_message:
      'Choose text, Markdown, RTF, Word, ODT, or XML files (or folders) to import.',
    download_chinese_authority_question: 'Download Chinese authority databases?',
    download_chinese_authority_detail:
      'This project uses Chinese as its source language. LEAF-Writer can download ' +
      'CBDB (China Biographical Database, ~600 MB) and the DILA Buddhist Studies ' +
      'authorities (~85 MB), plus compiled Wikidata packs, for automated tagging. They are ' +
      'stored locally on this machine (not synced with your entity database) and download in the background.',
    download: 'Download',
    not_now: 'Not now',
    preparing_download: 'Preparing download…',
    download_map_tiles_question: 'Download offline map tiles?',
    download_map_tiles_detail:
      'LEAF-Writer can download a basemap (streets, satellite, relief) for comparing ' +
      'place-name candidates on a map — up to 500 MB, stored locally on this machine ' +
      '(not synced with your entity database), used entirely offline once downloaded.',
    install_plugin_title: 'Install Grognard plugin',
    select_plugin_folder_message: 'Select a plugin package folder containing plugin.manifest.json.',
    move_entity_db_title: 'Move entity database?',
    move_entity_db_message:
      'Move your entity database from:\n{{source}}\n\nto:\n{{dest}}\n\nAll files will be copied to the new location and the old folder will be removed after a successful move.',
    move: 'Move',
    cancel: 'Cancel',
    choose_authority_packs_folder_title: 'Choose compiled authority packs folder',
    choose_authority_packs_folder_message:
      'Select the folder that contains cbdb/ and dila/ (e.g. authoritypacks/packs).',
    downloading_language_tool: 'Downloading LanguageTool…',
    extracting_language_tool: 'Extracting LanguageTool…',
    language_tool_installed: 'LanguageTool installed.',
    downloading_java: 'Downloading Java…',
    extracting_java: 'Extracting Java…',
    java_installed: 'Java installed.',
    downloading_english_ngrams: 'Downloading English n-grams (several GB)…',
    extracting_english_ngrams: 'Extracting English n-grams…',
    english_ngrams_installed: 'English n-grams installed.',
    checking_authority_pack_registry: 'Checking authority pack registry…',
    compiling_authority_packs_locally: 'Compiling authority packs locally…',
    downloading_reference_data: 'Downloading reference data: {{label}}…',
  },
  fr: {
    open_project_folder_title: 'Ouvrir un dossier de projet',
    entity_db_is_project_title: 'Ce dossier est votre base de données d’entités',
    entity_db_is_project_message:
      'Ce dossier est configuré comme votre dossier de base de données d’entités et ne peut pas être utilisé comme dossier de projet. Choisissez un dossier différent pour votre projet.',
    ok: 'OK',
    open_project_failed_message: 'Impossible d’ouvrir ce dossier de projet.',
    open_recent_project_failed_message: 'Ce projet récent n’est plus disponible.',
    choose_schema_file_title: 'Choisir un fichier de schéma (.rng)',
    choose_search_folder_title: 'Choisir le dossier à rechercher',
    choose_css_file_title: 'Choisir un fichier CSS (facultatif)',
    choose_css_file_message:
      'Facultatif : choisissez un fichier CSS pour ce schéma, ou Annuler pour ignorer.',
    import_documents_title: 'Importer des documents',
    import_documents_message:
      'Choisissez des fichiers texte, Markdown, RTF, Word, ODT ou XML (ou des dossiers) à importer.',
    download_chinese_authority_question: 'Télécharger les bases de données d’autorité chinoises ?',
    download_chinese_authority_detail:
      'Ce projet utilise le chinois comme langue source. LEAF-Writer peut télécharger ' +
      'CBDB (China Biographical Database, ~600 Mo) et les autorités bouddhiques DILA ' +
      '(~85 Mo), ainsi que des packs Wikidata compilés, pour le balisage automatisé. Elles sont ' +
      'stockées localement sur cette machine (non synchronisées avec votre base de données d’entités) et se téléchargent en arrière-plan.',
    download: 'Télécharger',
    not_now: 'Plus tard',
    preparing_download: 'Préparation du téléchargement…',
    download_map_tiles_question: 'Télécharger les tuiles de carte hors ligne ?',
    download_map_tiles_detail:
      'LEAF-Writer peut télécharger un fond de carte (rues, satellite, relief) pour comparer ' +
      'les candidats de noms de lieux sur une carte — jusqu’à 500 Mo, stocké localement sur cette machine ' +
      '(non synchronisé avec votre base de données d’entités), utilisable entièrement hors ligne une fois téléchargé.',
    install_plugin_title: 'Installer un plugin Grognard',
    select_plugin_folder_message:
      'Sélectionnez un dossier de paquet de plugin contenant plugin.manifest.json.',
    move_entity_db_title: 'Déplacer la base de données d’entités ?',
    move_entity_db_message:
      'Déplacer votre base de données d’entités depuis :\n{{source}}\n\nvers :\n{{dest}}\n\nTous les fichiers seront copiés vers le nouvel emplacement et l’ancien dossier sera supprimé une fois le déplacement réussi.',
    move: 'Déplacer',
    cancel: 'Annuler',
    choose_authority_packs_folder_title: 'Choisir le dossier des packs d’autorité compilés',
    choose_authority_packs_folder_message:
      'Sélectionnez le dossier contenant cbdb/ et dila/ (par exemple authoritypacks/packs).',
    downloading_language_tool: 'Téléchargement de LanguageTool…',
    extracting_language_tool: 'Extraction de LanguageTool…',
    language_tool_installed: 'LanguageTool installé.',
    downloading_java: 'Téléchargement de Java…',
    extracting_java: 'Extraction de Java…',
    java_installed: 'Java installé.',
    downloading_english_ngrams: 'Téléchargement des n-grammes anglais (plusieurs Go)…',
    extracting_english_ngrams: 'Extraction des n-grammes anglais…',
    english_ngrams_installed: 'N-grammes anglais installés.',
    checking_authority_pack_registry: 'Vérification du registre des packs d’autorité…',
    compiling_authority_packs_locally: 'Compilation locale des packs d’autorité…',
    downloading_reference_data: 'Téléchargement des données de référence : {{label}}…',
  },
} as const;

type MainStringKey = keyof (typeof STRINGS)['en'];

export const mainT = (key: MainStringKey, vars?: Record<string, string>): string => {
  const locale = getAppLocale() as keyof typeof STRINGS;
  const table = STRINGS[locale] ?? STRINGS.en;
  let value: string = table[key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{{${name}}}`, replacement);
    }
  }
  return value;
};
