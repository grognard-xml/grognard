import { getDefaultStore } from 'jotai';
import { RESET } from 'jotai/utils';
import $ from 'jquery';
import 'jquery-ui/ui/widgets/button';
import { entityLookupDialogAtom } from '../../../jotai/entity-lookup';
import Writer from '../../../js/Writer';
import Entity from '../../../js/entities/Entity';
import type { EntityType, SchemaMappingType } from '../../../types';
import { namedEntityTypesSchema } from '../../../types/authority';
import DialogForm from '../dialogForm/dialogForm';
import type { LWDialogConfigProps } from '../types';
import type { SchemaDialog } from './types';
import { certaintyOptions } from './util';
import i18next from 'i18next';

const defaultJotaiStore = getDefaultStore();

const personTypeOptions = ['real', 'fictional', 'identifiable'];

class PersonDialog implements SchemaDialog {
  readonly writer: Writer;
  readonly dialog: DialogForm;
  readonly parentEl: JQuery<HTMLElement>;

  readonly id: string;
  readonly mappingID: SchemaMappingType;

  entry?: Entity;
  selectedText?: string;
  currentKey?: string;
  type: EntityType = 'person';

  constructor({ writer, parentEl }: LWDialogConfigProps) {
    const mappingID = writer.schemaManager.mapper.currentMappingsId;
    if (!mappingID) throw Error('Schema Mappings not found');

    this.writer = writer;
    this.parentEl = parentEl;
    this.mappingID = mappingID;

    const idPrefix =
      this.mappingID === 'orlando' || this.mappingID == 'cwrcEntry'
        ? 'noteForm_' //orlando and cwrcEntry
        : 'personForm_'; //tei & teiLite

    this.id = writer.getUniqueId(idPrefix);

    const entityAttributesSection = `
      <div class="entityAttributes">
        ${this.selectedTextField(this.id)}
        ${this.tagAsField(this.id)}
        ${['tei', 'teiLite'].includes(this.mappingID) ? this.certaintyField(this.id) : ''}
        ${this.mappingID === 'tei' ? this.personTypeField(this.id) : ''}
      </div>
    `;

    const html = `
      <div class="annotationDialog">
        <div class="content">
          <div class="main">
            ${entityAttributesSection}

            <hr style="width: 100%; border: none; border-bottom: 1px solid #ccc;">
            
            <div
              id="${this.id}_attParent"
              class="attributes"
              data-type="attributes"
              data-mapping="attributes"
            />
          </div>

          <div class="attributeSelector">
            <h3 style="border-bottom: 1px solid #ddd; padding-bottom: 4px;">Attributes</h3>
            <ul></ul>
          </div>
        </div>
      </div>
    `;

    const $el = $(html).appendTo(parentEl);

    (
      $(`#${this.id}_keyPill`, $el) as JQuery<HTMLElement> & {
        button: (...args: unknown[]) => JQuery<HTMLElement>;
      }
    )
      .button()
      .on('click', () => {
        this.openEntityLookup();
      });

    this.dialog = new DialogForm({
      writer,
      $el,
      type: 'person',
      title: i18next.t('LW.Tag Person'),
    });

    // this.dialog.$el.on(
    //   'buildDynamicFields',
    //   (_event: JQuery.Event, _config: unknown, _dialog: DialogForm) => {},
    // );

    // this.dialog.$el.on(
    //   'beforeShow',
    //   (_event: JQuery.Event, _config: unknown, _dialog: DialogForm) => {},
    // );

    // this.dialog.$el.on('beforeSave', (_event: JQuery.Event, dialog: DialogForm) => {});
  }

  private openEntityLookup() {
    if (!this.currentKey) return;

    if ((window as Window & { __desktopLeftPanel?: unknown }).__desktopLeftPanel) {
      window.dispatchEvent(
        new CustomEvent('desktop-database:show-entity', {
          detail: { id: this.currentKey, type: this.type },
        }),
      );
      return;
    }

    this.parentEl.css('display', 'none');

    const isNamedEntityType = namedEntityTypesSchema.safeParse(this.type);
    if (!isNamedEntityType.success) {
      this.parentEl.css('display', 'block');
      return;
    }

    defaultJotaiStore.set(entityLookupDialogAtom, {
      isUserAuthenticated: this.writer.overmindState.user?.uri !== '#anonymous',
      onClose: () => {
        defaultJotaiStore.set(entityLookupDialogAtom, RESET);
        this.parentEl.css('display', 'block');
      },
      query: this.currentKey,
      type: isNamedEntityType.data,
    });
  }

  private updateLink(lemma: string, uri: string, key?: string) {
    if (this.entry) {
      this.writer.entitiesManager.setURIForEntity(this.entry.getId(), uri);
      this.writer.entitiesManager.setLemmaForEntity(this.entry.getId(), lemma);
      this.entry = this.writer.entitiesManager.getEntity(this.entry.getId());
    }

    this.updateTagAs(key);

    this.dialog.attributesWidget?.setAttribute('key', key ?? lemma);
    // Internal-only links (grognard-entity:) are keyed via @key, not @ref.
    if (/^https?:/i.test(uri)) this.dialog.attributesWidget?.setAttribute('ref', uri);
  }

  private updateTagAs(key?: string) {
    this.currentKey = key;

    const $keyPill = $(`#${this.id}_keyPill`);
    if (!key) {
      $keyPill.hide().text('');
      return;
    }

    $keyPill.text(key).show();
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

  private tagAsField(id: string) {
    return `
      <div id="${id}_tagAs" class="attribute">
        <button
          id="${id}_keyPill"
          type="button"
          class="entityKeyPill"
          style="display: none;"
        ></button>
      </div>
    `;
  }

  private certaintyField(id: string) {
    const fieldTitle = i18next.t('LW.Level of certainty');

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

        ${certaintyOptions
          .map((certainty) => {
            return `
            <input
              type="radio"
              id="${id}_${certainty}"
              name="${id}_id_certainty"
              value="${certainty}"
            />
            <label for="${id}_${certainty}" style="text-transform: capitalize">
              ${certainty}
            </label>
          `;
          })
          .join('\n')}
      </div>
    `;

    return html;
  }

  private personTypeField(id: string) {
    const fieldTitle = i18next.t('LW.Person type');

    const html = `
      <div
        id="${id}_type"
        class="attribute"
        data-transform="controlgroup"
        data-type="radio"
        data-mapping="type"
      >
        <div>
          <p class="fieldLabel">${fieldTitle}</p>
        </div>

        <div>
        ${personTypeOptions
          .map((type) => {
            return `
              <input type="radio" id="${id}_${type}" name="${id}_type" value="${type}" />
              <label for="${id}_${type}" style="text-transform: capitalize;">${type}</label>
            `;
          })
          .join('\n')}
        </div>
        <p style="font-size: 0.7rem; color: #666; margin-top: 8px;">
          Learn more about Person Types <a href="https://vocab.lincsproject.ca/Skosmos/edit/en/page/ModeExistence" target="_blank" style="border: unset; background-color: unset; padding: unset; text-decoration: revert; vertical-align: baseline;">here</a>.
        </p>
      </div>
    `;

    return html;
  }

  show(config: { entry: Entity; query: string; [x: string]: any }) {
    this.entry = config.entry ? config.entry : undefined;
    this.selectedText = config.entry ? config.entry.content : config.query;

    this.updateTextField(this.selectedText ?? '');
    this.updateTagAs(config.entry?.getAttribute('key') ?? config.key);

    this.dialog.show(config);
  }

  destroy() {
    this.dialog.destroy();
  }
}

export default PersonDialog;
