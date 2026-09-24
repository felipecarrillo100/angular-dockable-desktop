/**
 * The demo's message tables, in six locales.
 *
 * Keyed by the library's own message ids (`ndd.*`), so a `Record<MessageKey, string>` gives a
 * compile-time error for a key that is missing or misspelled — which is what `MessageKey` is
 * exported for.
 *
 * rdd's demo used `react-intl` for this. The library needs only `(descriptor) => string`, so
 * the demo supplies a twelve-line formatter instead and the table ports as plain data. A real
 * application would more likely hand `formatMessage` a lookup into its own translation service,
 * as the manual shows — the point of this file is that the integration surface is that small.
 */
import type { MessageDescriptor, MessageKey } from 'angular-dockable-desktop'

export type Locale = 'en' | 'es' | 'nl' | 'fr' | 'zh' | 'ar'

/** Every locale the demo offers, with the direction each is read in. */
export const LOCALES: { id: Locale; label: string; dir: 'ltr' | 'rtl' }[] = [
  { id: 'en', label: 'English', dir: 'ltr' },
  { id: 'es', label: 'Español', dir: 'ltr' },
  { id: 'nl', label: 'Nederlands', dir: 'ltr' },
  { id: 'fr', label: 'Français', dir: 'ltr' },
  { id: 'zh', label: '中文', dir: 'ltr' },
  { id: 'ar', label: 'العربية', dir: 'rtl' },
]

/** One locale's strings. Typed by `MessageKey`, so the set cannot drift from the library. */
type Table = Record<MessageKey, string>

const en: Table = {
  floatWindow: 'Float Window',
  minimizePanel: 'Minimize Panel',
  closeTab: 'Close Tab',
  restorePanel: 'Restore Panel',
  maximizePanel: 'Maximize Panel',
  closePanel: 'Close Panel',
  dockWindow: 'Dock Window',
  minimize: 'Minimize',
  maximize: 'Maximize',
  restoreSize: 'Restore Size',
  close: 'Close',
  closeEmptyGroup: 'Close empty split group',
  emptyGroup: 'Empty workspace section',
  unsavedChangesTitle: 'Unsaved Changes',
  unsavedChangesMessage: '"{title}" has unsaved changes. Discard them and close?',
  discardChanges: 'Discard Changes',
  cancel: 'Cancel',
  yes: 'Yes',
  no: 'No',
  ok: 'OK',
  closeTooltip: 'Close',
  scrollTabsLeft: 'Scroll tabs left',
  scrollTabsRight: 'Scroll tabs right',
  moreActions: 'More actions',
  search: 'Search',
}

const es: Table = {
  floatWindow: 'Ventana flotante',
  minimizePanel: 'Minimizar panel',
  closeTab: 'Cerrar pestaña',
  restorePanel: 'Restaurar panel',
  maximizePanel: 'Maximizar panel',
  closePanel: 'Cerrar panel',
  dockWindow: 'Acoplar ventana',
  minimize: 'Minimizar',
  maximize: 'Maximizar',
  restoreSize: 'Restaurar tamaño',
  close: 'Cerrar',
  closeEmptyGroup: 'Cerrar grupo vacío',
  emptyGroup: 'Sección vacía',
  unsavedChangesTitle: 'Cambios sin guardar',
  unsavedChangesMessage: '"{title}" tiene cambios sin guardar. ¿Descartarlos y cerrar?',
  discardChanges: 'Descartar cambios',
  cancel: 'Cancelar',
  yes: 'Sí',
  no: 'No',
  ok: 'Aceptar',
  closeTooltip: 'Cerrar',
  scrollTabsLeft: 'Desplazar pestañas a la izquierda',
  scrollTabsRight: 'Desplazar pestañas a la derecha',
  moreActions: 'Más acciones',
  search: 'Buscar',
}

const nl: Table = {
  floatWindow: 'Zwevend venster',
  minimizePanel: 'Paneel minimaliseren',
  closeTab: 'Tabblad sluiten',
  restorePanel: 'Paneel herstellen',
  maximizePanel: 'Paneel maximaliseren',
  closePanel: 'Paneel sluiten',
  dockWindow: 'Venster vastzetten',
  minimize: 'Minimaliseren',
  maximize: 'Maximaliseren',
  restoreSize: 'Grootte herstellen',
  close: 'Sluiten',
  closeEmptyGroup: 'Leeg groepsvak sluiten',
  emptyGroup: 'Leeg werkbladgedeelte',
  unsavedChangesTitle: 'Niet-opgeslagen wijzigingen',
  unsavedChangesMessage: '"{title}" heeft niet-opgeslagen wijzigingen. Verwerpen en sluiten?',
  discardChanges: 'Wijzigingen verwerpen',
  cancel: 'Annuleren',
  yes: 'Ja',
  no: 'Nee',
  ok: 'OK',
  closeTooltip: 'Sluiten',
  scrollTabsLeft: 'Tabbladen naar links schuiven',
  scrollTabsRight: 'Tabbladen naar rechts schuiven',
  moreActions: 'Meer acties',
  search: 'Zoeken',
}

const fr: Table = {
  floatWindow: 'Fenêtre flottante',
  minimizePanel: 'Réduire le panneau',
  closeTab: 'Fermer l\'onglet',
  restorePanel: 'Restaurer le panneau',
  maximizePanel: 'Agrandir le panneau',
  closePanel: 'Fermer le panneau',
  dockWindow: 'Ancrer la fenêtre',
  minimize: 'Réduire',
  maximize: 'Agrandir',
  restoreSize: 'Restaurer la taille',
  close: 'Fermer',
  closeEmptyGroup: 'Fermer le groupe vide',
  emptyGroup: 'Section vide',
  unsavedChangesTitle: 'Modifications non enregistrées',
  unsavedChangesMessage: '"{title}" contient des modifications non enregistrées. Les abandonner et fermer ?',
  discardChanges: 'Abandonner les modifications',
  cancel: 'Annuler',
  yes: 'Oui',
  no: 'Non',
  ok: 'OK',
  closeTooltip: 'Fermer',
  scrollTabsLeft: 'Défiler les onglets vers la gauche',
  scrollTabsRight: 'Défiler les onglets vers la droite',
  moreActions: 'Plus d\'actions',
  search: 'Rechercher',
}

const zh: Table = {
  floatWindow: '浮动窗口',
  minimizePanel: '最小化面板',
  closeTab: '关闭标签页',
  restorePanel: '还原面板',
  maximizePanel: '最大化面板',
  closePanel: '关闭面板',
  dockWindow: '停靠窗口',
  minimize: '最小化',
  maximize: '最大化',
  restoreSize: '还原大小',
  close: '关闭',
  closeEmptyGroup: '关闭空分组',
  emptyGroup: '空工作区',
  unsavedChangesTitle: '未保存的更改',
  unsavedChangesMessage: '"{title}" 有未保存的更改。放弃并关闭吗？',
  discardChanges: '放弃更改',
  cancel: '取消',
  yes: '是',
  no: '否',
  ok: '确定',
  closeTooltip: '关闭',
  scrollTabsLeft: '向左滚动标签页',
  scrollTabsRight: '向右滚动标签页',
  moreActions: '更多操作',
  search: '搜索',
}

const ar: Table = {
  floatWindow: 'نافذة عائمة',
  minimizePanel: 'تصغير اللوحة',
  closeTab: 'إغلاق التبويب',
  restorePanel: 'استعادة اللوحة',
  maximizePanel: 'تكبير اللوحة',
  closePanel: 'إغلاق اللوحة',
  dockWindow: 'إرساء النافذة',
  minimize: 'تصغير',
  maximize: 'تكبير',
  restoreSize: 'استعادة الحجم',
  close: 'إغلاق',
  closeEmptyGroup: 'إغلاق المجموعة الفارغة',
  emptyGroup: 'قسم فارغ',
  unsavedChangesTitle: 'تغييرات غير محفوظة',
  unsavedChangesMessage: '"{title}" يحتوي على تغييرات غير محفوظة. هل تريد تجاهلها والإغلاق؟',
  discardChanges: 'تجاهل التغييرات',
  cancel: 'إلغاء',
  yes: 'نعم',
  no: 'لا',
  ok: 'موافق',
  closeTooltip: 'إغلاق',
  scrollTabsLeft: 'تمرير التبويبات لليسار',
  scrollTabsRight: 'تمرير التبويبات لليمين',
  moreActions: 'مزيد من الإجراءات',
  search: 'بحث',
}

const TABLES: Record<Locale, Table> = { en, es, nl, fr, zh, ar }

/**
 * The whole integration surface: a function from a descriptor to a string.
 *
 * Falls back to the descriptor's own `defaultMessage` for any id the table does not carry, so
 * an untranslated string renders the library's English rather than a raw id.
 */
export function createFormatter(getLocale: () => Locale) {
  return (descriptor: MessageDescriptor): string => {
    const table = TABLES[getLocale()]
    const key = descriptor.id.replace(/^ndd\./, '') as MessageKey
    let text = table[key] ?? descriptor.defaultMessage ?? descriptor.id
    for (const [name, value] of Object.entries(descriptor.values ?? {})) {
      text = text.replace(`{${name}}`, String(value))
    }
    return text
  }
}

/** The demo's own strings, for its own UI. Same shape, so the same formatter serves both. */
export const UI: Record<Locale, Record<string, string>> = {
  en: { panels: 'Panels', layout: 'Layout', theme: 'Theme', locale: 'Language', reset: 'Reset layout', save: 'Save layout', load: 'Restore layout' },
  es: { panels: 'Paneles', layout: 'Diseño', theme: 'Tema', locale: 'Idioma', reset: 'Restablecer', save: 'Guardar diseño', load: 'Restaurar diseño' },
  nl: { panels: 'Panelen', layout: 'Indeling', theme: 'Thema', locale: 'Taal', reset: 'Herstellen', save: 'Indeling opslaan', load: 'Indeling laden' },
  fr: { panels: 'Panneaux', layout: 'Disposition', theme: 'Thème', locale: 'Langue', reset: 'Réinitialiser', save: 'Enregistrer', load: 'Restaurer' },
  zh: { panels: '面板', layout: '布局', theme: '主题', locale: '语言', reset: '重置布局', save: '保存布局', load: '恢复布局' },
  ar: { panels: 'اللوحات', layout: 'التنسيق', theme: 'المظهر', locale: 'اللغة', reset: 'إعادة تعيين', save: 'حفظ التنسيق', load: 'استعادة التنسيق' },
}
