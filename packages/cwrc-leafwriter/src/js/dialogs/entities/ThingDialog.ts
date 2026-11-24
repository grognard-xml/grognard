import { getDefaultStore } from 'jotai';
import { RESET } from 'jotai/utils';
import $ from 'jquery';
import 'jquery-ui/ui/widgets/selectmenu';
import { entityLookupDialogAtom } from '../../../jotai/entity-lookup';
import { EntityType, namedEntityTypesSchema } from '../../../types';
import Entity from '../../entities/Entity';
import Writer from '../../Writer';
import DialogForm from '../dialogForm/dialogForm';
import type { LWDialogConfigProps } from '../types';
import type { SchemaDialog } from './types';
import { certaintyOptions, getSourceNameFromUrl } from './util';
import i18next from 'i18next';

const defaultJotaiStore = getDefaultStore();

class ThingDialog implements SchemaDialog {
  readonly writer: Writer;
  readonly dialog: DialogForm;
  readonly $el: JQuery<HTMLElement>;

  entry?: Entity;
  selectedText?: string;
  type: EntityType = 'thing';

  constructor({ writer, parentEl }: LWDialogConfigProps) {
    this.writer = writer;
    const id = writer.getUniqueId('rsForm_');

    const entityAttributesSection = `
      <div class="entityAttributes">
        ${this.selectedTextField(id)}
        ${this.tagAsField(id)}
        ${this.certaintyField(id)}
       
      </div>
    `;

    this.$el = $(`
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
            <h3 style="border-bottom: 1px solid #ddd; padding-bottom: 4px;">Attributes</h3>
            <ul></ul>
          </div>
        </div>
      </div>
    `).appendTo(parentEl);

    //@ts-expect-error
    const $relinkButton = $(`#${id}_tagAs .relink-bt`, this.$el).button();
    $relinkButton.on('click', () => {
      parentEl.css('display', 'none');

      const isNamedEntityType = namedEntityTypesSchema.safeParse(this.type);
      if (isNamedEntityType.success) {
        const namedEntityType = isNamedEntityType.data;

        defaultJotaiStore.set(entityLookupDialogAtom, {
          isUserAuthenticated: this.writer.overmindState.user?.uri !== '#anonymous',
          onClose: (response) => {
            defaultJotaiStore.set(entityLookupDialogAtom, RESET);
            parentEl.css('display', 'block');
            if (!response) {
              this.updateTagAs();
              return;
            }
            this.updateLink(response.name, response.uri, response.key);
            this.updateTagAs(response.name, response.uri);
          },
          query: this.entry?.getContent()?.trim() ?? '',
          type: namedEntityType,
        });
      }
    });

    this.dialog = new DialogForm({
      writer,
      $el: this.$el,
      type: 'thing',
      title: 'Tag Thing',
    });

    //?dialog events
    // Uncomment tag next line if needed
    // this.dialog.$el.on('beforeShow', (event: JQuery.Event, config: any) => {});

    this.dialog.$el.on('beforeSave', (_event: JQuery.Event, _config: unknown) => {
      if (this.dialog.currentData.attributes.type === '') {
        delete this.dialog.currentData.attributes.type;
      }
    });
  }

  private updateLink(lemma: string, uri: string, key?: string) {
    if (this.entry) {
      this.writer.entitiesManager.setURIForEntity(this.entry.getId(), uri);
      this.writer.entitiesManager.setLemmaForEntity(this.entry.getId(), lemma);
      this.entry = this.writer.entitiesManager.getEntity(this.entry.getId());
    }

    this.updateTagAs(lemma, uri);

    this.dialog.attributesWidget?.setAttribute('key', key ?? lemma);
    // Internal-only links (grognard-entity:) are keyed via @key, not @ref.
    if (/^https?:/i.test(uri)) this.dialog.attributesWidget?.setAttribute('ref', uri);
  }

  private updateTagAs(lemma?: string, uri?: string) {
    if (!lemma || !uri) {
      $('.tagAsSource').hide();
      $('.tagAsSourceLink').text('');
      $('.tagAsSourceLink').attr('href', '');
      return;
    }

    $('.tagAs').text(lemma);

    const source = getSourceNameFromUrl(uri);

    $('.tagAsSource').show();
    $('.tagAsSourceLink').text(source);
    $('.tagAsSourceLink').attr('href', uri);
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
    const fieldTitle = i18next.t('LW.Tag as');

    return `
      <div id="${id}_tagAs" class="attribute">
        <div style="display: flex; align-items: center; gap: 8px;">
        <p class="fieldLabel">${fieldTitle}</p>
        
        <div class="relink-bt" style="cursor: pointer; padding: 4px;">
          <i class="fas fa-edit" />
        </div>
      </div>

        
        <div style="display: flex; flex-direction: column;" >
          <span class="tagAs" data-type="label" data-mapping="prop.lemma"></span>
          <span class="tagAsSource" style="color: #999; display: none;">source: 
          <a class="tagAsSourceLink" href="" target="_blank" rel="noopener noreferrer nofollow"></a>
          </span>
        </div>
      </div>
    `;
  }

  private certaintyField(id: string) {
    const fieldTitle = i18next.t('LW.Level of certainty');

    return `
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
  }

  show(config: { [x: string]: any; entry: Entity; query: string }) {
    this.entry = config.entry ? config.entry : undefined;
    this.selectedText = config.entry ? config.entry.content : config.query;

    this.updateTextField(this.selectedText ?? '');
    if (config.name && config.uri) this.updateTagAs(config.name, config.uri);
    if (!config.uri) this.updateTagAs();

    this.dialog.show(config);
  }

  destroy() {
    this.dialog.destroy();
  }
}

export default ThingDialog;
