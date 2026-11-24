import $ from 'jquery';
import 'jquery-ui/ui/widgets/button';
import 'jquery-ui/ui/widgets/datepicker';
import { DateTime } from 'luxon';
import Entity from '../../../js/entities/Entity';
import type { EntityType, SchemaMappingType } from '../../../types';
import Writer from '../../Writer';
import DialogForm from '../dialogForm/dialogForm';
import type { LWDialogConfigProps } from '../types';
import type { SchemaDialog } from './types';
import {
  hasEastAsianCalendarContext,
  mergeEastAsianIntoAttributes,
  readEastAsianDateValues,
} from '../../../dateAuthority/values';
import { isCjkDatesEnabled } from '../../../plugins/registry';
import { isEastAsianCalendarLanguageCode } from '../../../utilities/languageCodes';
import i18next from 'i18next';

type EastAsianDateMount = typeof import('../../../dateAuthority/eastAsianDateMount');

type DateTypes = 'date' | 'range' | 'DATE' | 'DATERANGE' | 'DATESTRUCT';

const dateTypeTeiOptions = [
  { label: i18next.t('LW.Single Date'), value: 'date' },
  { label: i18next.t('LW.Date Range'), value: 'range' },
];

const dateTypeOrlandoOptions = [
  { label: i18next.t('LW.Single Date'), value: 'DATE' },
  { label: i18next.t('LW.Date Range'), value: 'DATERANGE' },
  { label: i18next.t('LW.Season/Occasion'), value: 'DATESTRUCT' },
];

const certaintyTeiOptions = [
  { label: 'high', value: 'high' },
  { label: 'medium', value: 'medium' },
  { label: 'low', value: 'low' },
  { label: i18next.t('LW.Unknown'), value: 'Unknown' },
];

const certaintyOrlandoOptions = [
  { label: i18next.t('LW.Certain'), value: 'CERT' },
  { label: i18next.t('LW.Circa'), value: 'C' },
  { label: i18next.t('LW.By this date'), value: 'BY' },
  { label: i18next.t('LW.After this date'), value: 'AFTER' },
  { label: i18next.t('LW.Unknown date'), value: 'UNKNOWN' },
  { label: i18next.t('LW.Rough certainty'), value: 'ROUGHLYDATED' },
];

const calendarTypeOptions = [
  { type: 'NEWSTYLE', label: i18next.t('LW.New style') },
  { type: 'BC', label: i18next.t('LW.BC') },
];

class DateDialog implements SchemaDialog {
  readonly writer: Writer;
  readonly dialog: DialogForm;
  readonly $dateInput: JQuery<HTMLElement>;
  readonly mappingID: SchemaMappingType;

  readonly DATE_DATA_FIELD: 'when' | 'VALUE';
  readonly FROM_DATA_FIELD: 'from' | 'FROM';
  readonly TO_DATA_FIELD: 'to' | 'TO';

  entry?: Entity;
  selectedText?: string;
  type: EntityType = 'date';

  dateRange: any;
  eastAsianMode = false;
  private eastAsianMount: EastAsianDateMount | null = null;
  private readonly formId: string;

  constructor({ writer, parentEl }: LWDialogConfigProps) {
    const mappingID = writer.schemaManager.mapper.currentMappingsId;
    if (!mappingID) throw Error('Schema Mappings not found');

    this.writer = writer;
    this.mappingID = mappingID;

    this.DATE_DATA_FIELD = this.schemaMappingMatch(['orlando', 'cwrcEntry'])
      ? 'VALUE' //orlando and cwrcEntry
      : 'when'; //tei & teiLite

    this.FROM_DATA_FIELD = this.schemaMappingMatch(['orlando', 'cwrcEntry'])
      ? 'FROM' //orlando and cwrcEntry
      : 'from'; //tei & teiLite

    this.TO_DATA_FIELD = this.schemaMappingMatch(['orlando', 'cwrcEntry'])
      ? 'TO' //orlando and cwrcEntry
      : 'to'; //tei & teiLite

    const idPrefix = this.schemaMappingMatch('cwrcEntry') ? 'dateForm_' : 'dateForm_';
    const id = writer.getUniqueId(idPrefix);
    this.formId = id;

    const today = new Date();
    const upperLimit = today.getFullYear() + 10;

    const entityAttributesSection = `
      <div class="entityAttributes">
        ${this.selectedTextField(id)}
        ${this.dateTypeField(id)}
        ${this.dateField(id)}
        ${this.rangeField(id)}
        <div id="${id}_eastAsianDates" class="attribute eastAsianDateFields" style="display:none"></div>
        ${this.certaintyField(id)}
        ${this.schemaMappingMatch(['orlando', 'cwrcEntry']) ? this.calendarField(id) : ''} 
      </div>
    `;

    const $el = $(`
      <div class="annotationDialog">
        <div class="content">
          <div class="main">
            ${entityAttributesSection}
            
            <hr style="width: 100%; border: none; border-bottom: 1px solid #ccc;">
            
            <div
              id="${id}_attParent"
              class="attributes"
              data-type="attributes"
              data-mapping="attributes"
            />
          </div>

          <div class="attributeSelector">
            <h3 style="border-bottom: 1px solid #ddd; padding-bottom: 4px;">${i18next.t('LW.Attributes')}</h3>
            <ul></ul>
          </div>
        </div>
      </div>
    `).appendTo(parentEl);

    this.dialog = new DialogForm({ writer, $el, type: 'date', title: i18next.t('LW.Tag Date') });

    //date type event
    $(`#${id}_type input`).on('click', function () {
      const inputVal = $(this).val();
      toggleDate(inputVal as DateTypes);
    });

    //single date event
    this.$dateInput = $(`#${id}_cwrc_datePicker`);
    this.$dateInput.on('focus', function () {
      $(this).css({ borderBottom: '' });
    });

    //@ts-expect-error
    this.$dateInput.datepicker({
      dateFormat: 'yy-mm-dd',
      constrainInput: false,
      changeMonth: true,
      changeYear: true,
      yearRange: '-210:+10',
      minDate: new Date(1800, 0, 1),
      maxDate: new Date(upperLimit, 11, 31),
      showOn: 'button',
      buttonText: i18next.t('LW.Date Picker'),
      buttonImage: `${writer.baseUrl}/images/calendar-alt-regular.svg`,
      buttonImageOnly: true,
    });

    // TODO find a better way to do this
    $('#ui-datepicker-div').appendTo(parentEl);

    //range date events
    const $startDate = $(`#${id}_startDate`);
    $startDate.on('focus', function () {
      $(this).css({ borderBottom: '' });
    });

    const $endDate = $(`#${id}_endDate`);
    $endDate.on('focus', function () {
      $(this).css({ borderBottom: '' });
    });

    const _this = this;

    //@ts-expect-error
    this.dateRange = $(`#${id}_startDate, #${id}_endDate`).datepicker({
      dateFormat: 'yy-mm-dd',
      constrainInput: false,
      changeMonth: true,
      changeYear: true,
      yearRange: '-210:+10',
      minDate: new Date(1800, 0, 1),
      maxDate: new Date(upperLimit, 11, 31),
      showOn: 'button',
      buttonText: i18next.t('LW.Date Picker'),
      buttonImage: `${writer.baseUrl}/images/calendar-alt-regular.svg`,
      buttonImageOnly: true,
      onSelect: function (selectedDate: any) {
        const option = this.id.indexOf('startDate') === -1 ? 'maxDate' : 'minDate';
        const instance = $(this).data('datepicker');

        //@ts-expect-error
        const date = $.datepicker.parseDate(
          //@ts-expect-error
          instance.settings.dateFormat || $.datepicker._defaults.dateFormat,
          selectedDate,
          instance.settings,
        );

        _this.dateRange.not(this).datepicker('option', option, date);

        if (_this.schemaMappingMatch(['orlando', 'cwrcEntry'])) {
          $(this).trigger('change');
        }
      },
    });

    const toggleDate = (type: DateTypes) => {
      this.$dateInput.val('');
      $startDate.val('');
      $endDate.val('');

      if (type === 'date' || type === 'DATE' || type === 'DATESTRUCT') {
        $(`#${id}_date`).show();
        $(`#${id}_range`).hide();
        return;
      }

      if (type === 'range' || type === 'DATERANGE') {
        $(`#${id}_date`).hide();
        $(`#${id}_range`).show();
        return;
      }

      if (this.schemaMappingMatch(['orlando', 'cwrcEntry'])) {
        const atts = this.writer.schemaManager.getAttributesForTag(type);
        this.dialog.attributesWidget?.buildWidget({ atts, tagName: type });
        this.dialog.attWidgetInit = true;
        this.dialog.attributesWidget?.reset();
      }
    };

    this.dialog.$el.on('beforeShow', (_event: JQuery.Event, config: any) => {
      void this.prepareEastAsianMode(config);

      this.dateRange.datepicker('option', 'minDate', new Date(1800, 0, 1));
      this.dateRange.datepicker('option', 'maxDate', new Date(upperLimit, 11, 31));

      if (this.dialog.mode === DialogForm.ADD) {
        let dateValue = '';

        const currentBookmark = window.writer?.editor?.currentBookmark;
        if (!currentBookmark) return;

        const dateString = 'rng' in currentBookmark ? currentBookmark.rng.toString() : '';

        if (dateString !== '') {
          const dateLuxon = DateTime.fromISO(dateString);

          if (dateLuxon.isValid) {
            const dateObj = dateLuxon.toJSDate(); // use luxon library to parse date string properly
            let year = dateObj.getFullYear();

            if (dateString.length > 4) {
              let month = dateObj.getMonth();
              month++; // month is zero based index
              const monthString = month < 10 ? `0${month}` : month;
              const day = dateObj.getDate();
              const dayString = day < 10 ? `0${day}` : day;
              dateValue = `${year}-${monthString}-${dayString}`;
            } else {
              year++; // if just the year, Date makes it dec 31st at midnight of the prior year
              dateValue = year.toString();
            }
          }
        }

        const dateField = this.schemaMappingMatch(['orlando', 'cwrcEntry']) ? 'DATE' : 'date';

        toggleDate(dateField);

        $(`#${id}_type_${dateField}`).prop('checked', true);
        this.$dateInput.val(dateValue);
        $startDate.val('');
        $endDate.val('');
      } else {
        const data = config.entry.getAttributes();

        if (data.when || data.VALUE) {
          const dateField = this.schemaMappingMatch(['orlando', 'cwrcEntry']) ? 'DATE' : 'date';

          toggleDate(dateField);
          $(`#${id}_type_${dateField}`).prop('checked', true);

          this.$dateInput.val(data[this.DATE_DATA_FIELD]);

          $startDate.val('');
          $endDate.val('');
        } else {
          const dateField = this.schemaMappingMatch(['orlando', 'cwrcEntry'])
            ? 'DATERANGE'
            : 'range';

          toggleDate(dateField);
          $(`#${id}_type_${dateField}`).prop('checked', true);

          this.$dateInput.val('');

          $startDate.val(data[this.FROM_DATA_FIELD]);
          $startDate.val(data[this.TO_DATA_FIELD]);
        }
      }

      //! this breaks initial values on inputs
      // $(`#${id}_type input`).button('refresh');

      this.$dateInput.css({ borderBottom: '' });
      $startDate.css({ borderBottom: '' });
      $endDate.css({ borderBottom: '' });
      this.$dateInput[0]?.focus({ preventScroll: true });
    });

    this.dialog.$el.on('beforeSave', (_event: JQuery.Event, dialog: DialogForm) => {
      if (this.eastAsianMode) {
        const eastAsian =
          this.eastAsianMount?.getEastAsianDateFieldValues() ?? readEastAsianDateValues({});
        if (!hasEastAsianCalendarContext(eastAsian)) {
          dialog.isValid = false;
          return;
        }
        Object.assign(
          dialog.currentData.attributes,
          mergeEastAsianIntoAttributes(dialog.currentData.attributes, eastAsian),
        );
        if (!dialog.currentData.attributes.cert) {
          dialog.currentData.attributes.cert = 'low';
        }
        dialog.isValid = true;
        return;
      }

      const type: DateTypes = $(`#${id}_type input:checked`).val() as DateTypes;
      let error = false;

      if (type === 'date' || type === 'DATE' || type === 'DATESTRUCT') {
        let dateString = this.$dateInput.val();
        if (!dateString) {
          dialog.isValid = false;
          return;
        }

        if (Array.isArray(dateString)) dateString = dateString[0];
        if (typeof dateString === 'number') dateString = dateString.toString();

        const dateLuxon = DateTime.fromISO(dateString);

        if (dateLuxon.isValid) {
          dialog.currentData.attributes[this.DATE_DATA_FIELD] = dateString;
        } else {
          this.$dateInput.css({ borderBottom: '1px solid red' });
          error = true;
        }
      } else {
        let startString = $startDate.val();
        let endString = $endDate.val();

        if (!startString || !endString) {
          dialog.isValid = false;
          return;
        }

        if (Array.isArray(startString)) startString = startString[0];
        if (Array.isArray(endString)) endString = endString[0];

        if (typeof startString === 'number') startString = startString.toString();
        if (typeof endString === 'number') endString = endString.toString();

        const startLuxon = DateTime.fromISO(startString);
        const endLuxon = DateTime.fromISO(endString);

        if (startLuxon.isValid) {
          dialog.currentData.attributes[this.FROM_DATA_FIELD] = startString;
        } else {
          $startDate.css({ borderBottom: '1px solid red' });
          error = true;
        }

        if (endLuxon.isValid) {
          dialog.currentData.attributes[this.TO_DATA_FIELD] = endString;
        } else {
          $endDate.css({ borderBottom: '1px solid red' });
          error = true;
        }

        if (startLuxon > endLuxon) {
          $startDate.css({ borderBottom: '1px solid red' });
          $endDate.css({ borderBottom: '1px solid red' });
          error = true;
        }
      }

      dialog.isValid = error ? false : true;
    });
  }

  private async prepareEastAsianMode(config?: { entry?: Entity }) {
    const id = this.formId;
    if (this.schemaMappingMatch(['orlando', 'cwrcEntry'])) {
      this.eastAsianMode = false;
      return;
    }

    const language = (await window.__leafWriterProject?.getProjectSourceLanguage?.()) ?? null;
    this.eastAsianMode = isCjkDatesEnabled() && isEastAsianCalendarLanguageCode(language);
    const $eastAsian = $(`#${id}_eastAsianDates`);

    if (!this.eastAsianMode) {
      $eastAsian.hide();
      $(`#${id}_date`).show();
      $(`#${id}_type`).show();
      return;
    }

    $eastAsian.show();
    $(`#${id}_date`).hide();
    $(`#${id}_range`).hide();
    $(`#${id}_type`).hide();

    const initial = config?.entry
      ? readEastAsianDateValues(config.entry.getAttributes())
      : readEastAsianDateValues({});

    const container = $eastAsian[0];
    if (container) {
      const mount = await this.loadEastAsianMount();
      mount.mountEastAsianDateFields(container, { initialValues: initial });
    }
  }

  private async loadEastAsianMount(): Promise<EastAsianDateMount> {
    if (!this.eastAsianMount) {
      this.eastAsianMount = await import('../../../dateAuthority/eastAsianDateMount');
    }
    return this.eastAsianMount;
  }

  private selectedTextField(id: string) {
    const fieldTitle = i18next.t('LW.Selected Text');

    return `
      <div id="${id}_selectedText" class="attribute">
        <p class="fieldLabel">${fieldTitle}</p>
        <p class="selectedText">${this.selectedText}</p>
      </div>
    `;
  }

  private updateTextField(value: string) {
    const fontSize = value.length > 30 ? 1 : 1.2;
    $('.selectedText').css('font-size', `${fontSize}em`);
    $('.selectedText').text(value);
  }

  private dateTypeField(id: string) {
    const fieldTitle = i18next.t('LW.Date type');

    const options = this.schemaMappingMatch(['orlando', 'cwrcEntry'])
      ? dateTypeOrlandoOptions
      : dateTypeTeiOptions;

    const html = `
      <div
        id="${id}_type"
        class="attribute"
        data-transform="controlgroup"
        data-type="radio"
        ${this.schemaMappingMatch(['orlando', 'cwrcEntry']) ? 'data-mapping="prop.tag"' : ''}
      >
        <div>
          <p class="fieldLabel">${fieldTitle}</p>
        </div>

        ${options
          .map(({ label, value }, index) => {
            //exception
            if (this.schemaMappingMatch('cwrcEntry') && value === 'DATESTRUCT') return '';

            return `
            <input
              type="radio"
              id="${id}_type_${value}"
              name="dateType"
              value="${value}"
              ${index === 0 ? 'checked="checked"' : ''}
            />
            <label for="${id}_type_${value}" style="text-transform: capitalize">
              ${label}
            </label>
          `;
          })
          .join('\n')}
      </div>
    `;

    return html;
  }

  private dateField(id: string) {
    const fieldTitle = i18next.t('LW.Date');

    const html = `
      <div id="${id}_date" class="attribute">
        <div>
          <p class="fieldLabel">${fieldTitle}</p>
        </div>

        <div style="display: flex;">
          <input
            type="text"
            data-type="textbox"
            data-mapping="${this.DATE_DATA_FIELD}"
            id="${id}_cwrc_datePicker"
          />
        </div>

        <div style="margin-top: 4px; font-size: 0.7rem; color: #666;">
          Format: YYYY, YYYY-MM, or YYYY-MM-DD<br /><i>e.g.,</i> 2010, 2010-10, 2010-10-31
        </div>
      </div>
    `;

    return html;
  }

  private rangeField(id: string) {
    const fieldStartTitle = i18next.t('LW.Start date');
    const fieldEndTitle = i18next.t('LW.End date');

    const html = `
      <div
        id="${id}_range"
        style="
          display: flex;
          flex-direction: column;
          gap: 8px;
        "
      >
        <div class="attribute">
          <div>
            <p class="fieldLabel">${fieldStartTitle}</p>
          </div>

          <div style="display: flex;">
            <input
              type="text"
              data-type="textbox"
              data-mapping="${this.FROM_DATA_FIELD}"
              id="${id}_startDate"
            />
          </div>
        </div>
        
        <div class="attribute">
          <div>
            <p class="fieldLabel">${fieldEndTitle}</p>
          </div>
          
          <div style="display: flex;">
            <input
              type="text"
              data-type="textbox"
              data-mapping="${this.TO_DATA_FIELD}"
              id="${id}_endDate"
            />
          </div>
        </div>

        <div style="margin-left: 8px; font-size: 0.7rem; color: #666;">
          Format: YYYY, YYYY-MM, or YYYY-MM-DD<br /><i>e.g.,</i> 2010, 2010-10, 2010-10-31
        </div>
      </div>
    `;

    return html;
  }

  private certaintyField(id: string) {
    const fieldTitle = i18next.t('LW.Level of certainty');

    const options = this.schemaMappingMatch(['orlando', 'cwrcEntry'])
      ? certaintyOrlandoOptions
      : certaintyTeiOptions;

    const html = `
      <div
        id="${id}_certainty"
        class="attribute"
        data-transform="controlgroup"
        data-type="radio"
        data-mapping="cert"
      >
        <div>
          <p class="fieldLabel">${fieldTitle}</p>
        </div>

        ${options
          .map(({ label, value }) => {
            return `
            <input
              type="radio"
              id="${id}_${value}"
              name="${id}_id_certainty"
              value="${value}"
            />
            <label for="${id}_${value}" style="text-transform: capitalize">
              ${label}
            </label>
          `;
          })
          .join('\n')}
      </div>
    `;

    return html;
  }

  private calendarField(id: string) {
    const fieldTitle = i18next.t('LW.Calendar type');

    const html = `
      <div
        id="${id}_calendar"
        class="attribute"
        data-transform="controlgroup"
        data-type="radio"
        data-mapping="CALENDAR"
      >
        <div>
          <p class="fieldLabel">${fieldTitle}</p>
        </div>

        ${calendarTypeOptions
          .map(({ type, label }) => {
            return `
            <input
              type="radio"
              id="${id}_${type}"
              name="calendarType"
              value="${type}"
            />
            <label for="${id}_${type}" style="text-transform: capitalize">
              ${label}
            </label>
          `;
          })
          .join('\n')}
      </div>
    `;

    return html;
  }

  private schemaMappingMatch(value: SchemaMappingType | SchemaMappingType[]) {
    if (Array.isArray(value)) {
      for (const mappingID of value) {
        if (this.mappingID === mappingID) return true;
      }
      return false;
    }

    return this.mappingID === value;
  }

  private getSelection() {
    const currentBookmark = this.writer.editor?.currentBookmark;
    if (!currentBookmark) return;

    if ('rng' in currentBookmark) {
      let selection = currentBookmark.rng.toString();
      selection = selection.trim().replace(/\s+/g, ' '); // remove excess whitespace
      return selection;
    }
    return;
  }

  show(config?: { [x: string]: any; entry: Entity }) {
    this.entry = config?.entry ? config.entry : undefined;
    this.selectedText = config?.entry ? config.entry.content : this.getSelection();

    this.updateTextField(this.selectedText ?? '');

    this.dialog.show(config);
  }

  destroy() {
    this.eastAsianMount?.unmountEastAsianDateFields();
    this.eastAsianMount = null;

    //@ts-expect-error
    this.$dateInput.datepicker('destroy');
    this.dateRange.datepicker('destroy');
    this.dialog.destroy();
  }
}

export default DateDialog;
