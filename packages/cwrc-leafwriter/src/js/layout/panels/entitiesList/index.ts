import $ from 'jquery';
import 'jquery-ui/ui/effect';
import 'jquery-ui/ui/widgets/button';
import 'jquery-ui/ui/widgets/selectmenu';
import 'jquery-ui/ui/widgets/tooltip';
import Entity from '../../../../js/entities/Entity';
import { log } from '../../../../utilities';
import { getSvg } from '../../../../icons';
import type { SortingTypes } from '../../../entities/entitiesManager';
import { RESERVED_ATTRIBUTES } from '../../../schema/mapper';
import Writer from '../../../Writer';

interface EntitiesListProps {
  parentId: string;
  writer: Writer;
}

/**
 * @class EntitiesList
 * @fires Writer#entitiesListInitialized
 * @param {Object} config destructured
 * @param {Writer} config.writer
 * @param {String} config.parentId
 */
class EntitiesList {
  readonly id: string;
  readonly $entities: JQuery<HTMLElement>;
  readonly writer: Writer;

  enabled = true; // enabled means we update based on events
  isConvert = false; // are we in convert mode
  updatePending = false;

  constructor({ parentId, writer }: EntitiesListProps) {
    this.writer = writer;
    this.id = parentId;

    const scrapeCandidateEntitiesButton = `
      <button type="button" class="convert">Scrape Candidate Entities</button>
    `;

    const convertActionsComponent = `
      <div class="convertActions" style="display: none; width: 100%;">
        <div style="display: flex; flex-direction: row; justify-content: space-between;">
          <button type="button" class="accept">Accept All</button>
          <button type="button" class="reject">Reject All</button>
          <button type="button" class="done">Done</button>
        </div>
      </div>
    `;

    const filterComponent = `
      <div style="display: inline-block;">
        <label for="filter" title="Filter" class="fas fa-filter"></label>
        <select name="filter">
            <option value="all" selected="selected">All</option>
            <option value="person">Person</option>
            <option value="place">Place</option>
            <option value="organization">Organization</option>
            <option value="work">Work</option>
            <option value="thing">Thing</option>
            <option value="citation">Citation</option>
            <option value="note">Note</option>
            <option value="date">Date</option>
            <option value="correction">Correction</option>
            <option value="keyword">Keyword</option>
            <option value="link">Link</option>
        </select>
      </div>
    `;

    const sortComponent = `
      <div style="display: inline-block;">
        <label for="sorting" title="Sorting" class="fas fa-sort"></label>
        <select name="sorting">
          <option value="seq" selected="selected">Sequential</option>
          <option value="alpha">Alphabetical</option>
          <option value="cat">Categorical</option>
        </select>
      </div> 
    `;

    this.$entities = $(`#${this.id}`);

    this.$entities.append(`
      <div class="moduleParent entitiesPanel">
        <div class="moduleHeader">
          <div style="text-align= center; padding-bottom: 4px;">
            <h3 id="candidate-entities-title" style="display: none;">
              Candidate Entities
            </h3>
          </div>
          <div>
            ${filterComponent}
            ${sortComponent}
          </div>
        </div>
        <div class="subheader" style="display: none;">
          <span>Candidate Entities</span>
        </div>
        <div class="moduleContent">
          <div class="entitiesList"/>
        </div>
        <div class="moduleFooter" style="display: flex; justify-content: center;">
          ${scrapeCandidateEntitiesButton}
          ${convertActionsComponent}
        </div>
      </div>
    `);

    if (this.writer.isReadOnly) this.$entities.find('.moduleFooter').hide();

    //@ts-expect-error

    this.$entities.find('select').selectmenu({
      appendTo: this.writer.layoutManager.getContainer(),
      position: { my: 'left top', at: 'left bottom', collision: 'flipfit' },
      width: 120,
    });

    this.$entities
      .find('button.convert')
      //@ts-expect-error
      .button()
      .click(() => {
        //* Prevent Trigger LW change event
        this.writer.overmindActions.editor.suspendLWChangeEvent(true);

        this.convertEntities();
      });

    this.$entities
      .find('button.accept')
      //@ts-expect-error
      .button()
      .click(() => {
        this.acceptAll();
        this.update();
      });

    this.$entities
      .find('button.reject')
      //@ts-expect-error
      .button()
      .click(() => {
        this.rejectAll();
        this.update();
      });

    this.$entities
      .find('button.done')
      //@ts-expect-error
      .button()
      .click(() => {
        if (this.getCandidates().length <= 0) {
          this.handleDone();

          //* Resume LW change Event
          this.writer.overmindActions.editor.suspendLWChangeEvent(false);
          return;
        }

        this.writer.dialogManager.confirm({
          title: 'Warning',
          msg: `
            <p>All the remaining entities in the panel will be rejected.</p>
            <p>Do you wish to proceed?</p>
          `,
          showConfirmKey: 'confirm-reject-candidate-entities',
          type: 'info',
          callback: (doIt: boolean) => {
            if (doIt) {
              this.rejectAll();
              this.handleDone();

              //* Resume LW change Event
              this.writer.overmindActions.editor.suspendLWChangeEvent(false);
            }
          },
        });
      });

    this.$entities.find('select[name="filter"]').on('selectmenuchange', () => this.update());
    this.$entities.find('select[name="sorting"]').on('selectmenuchange', () => this.update());

    this.writer.event('loadingDocument').subscribe(() => {
      this.clear();
      this.handleDone();
      this.disable();
    });
    this.writer.event('documentLoaded').subscribe((success: boolean) => {
      if (success) {
        this.enable(true);
        return;
      }
      this.clear();
      this.disable();
    });
    this.writer.event('schemaLoaded').subscribe(() => this.update());
    this.writer.event('contentChanged').subscribe(() => this.update());
    this.writer.event('contentPasted').subscribe(() => this.update());
    this.writer.event('entityAdded').subscribe(() => this.update());
    this.writer.event('entityEdited').subscribe(() => this.update());
    this.writer.event('entityRemoved').subscribe((entityId: string) => this.remove(entityId));
    this.writer.event('entityFocused').subscribe((entityId: string) => {
      this.$entities
        .find(`div.entitiesList > li[data-id="${entityId}"]`)
        //@ts-expect-error
        .addClass('expanded', { duration: 200, queue: true });
    });
    this.writer.event('entityUnfocused').subscribe(() => {
      this.$entities.find('div.entitiesList > li').each(function (_index: any, _el: any) {
        //@ts-expect-error
        $(this).removeClass('expanded', { duration: 200, queue: true });
      });
    });
    this.writer.event('entityPasted').subscribe(() => this.update());
    this.writer.event('massUpdateStarted').subscribe(() => this.disable());
    this.writer.event('massUpdateCompleted').subscribe(() => this.enable(true));

    // add to writer
    this.writer.entitiesList = this;

    this.writer.event('entitiesListInitialized').publish(this);
  }

  private acceptAll() {
    const filter = this.getFilter();
    this.writer.entitiesManager.eachEntity((_index: number, entity: Entity) => {
      const isCandidate = entity.getAttribute('_candidate');
      const type = entity.getType();

      if (isCandidate === 'true') {
        if (filter === 'all' || filter === type) {
          this.acceptEntity(entity.getId());
        }
      }
    });
    this.setFilter('all');
  }

  private getFilter() {
    return this.$entities.find('select[name="filter"]').val();
  }

  private acceptEntity(entityId: string) {
    const entity = this.writer.entitiesManager.getEntity(entityId);
    entity?.removeAttribute('_candidate');
    $(`#${entity?.id}`, this.writer.editor?.getBody()).removeAttr('_candidate');
  }

  private setFilter(value: string) {
    //@ts-expect-error
    return this.$entities.find('select[name="filter"]').val(value).selectmenu('refresh');
  }

  // CONVERSION

  private getCandidates() {
    let entities = this.writer.entitiesManager.getEntitiesArray();
    entities = entities.filter((entry) => entry.getAttribute('_candidate') === 'true');
    return entities;
  }

  private rejectEntity(entityId: string) {
    return this.writer.tagger.removeEntity(entityId);
  }

  private acceptMatching(entityId: string) {
    const matches = this.getMatchesForEntity(entityId);

    this.acceptEntity(entityId);
    matches.forEach((entId: string) => this.acceptEntity(entId));
  }

  private rejectMatching(entityId: string) {
    const matches = this.getMatchesForEntity(entityId);

    this.rejectEntity(entityId);
    matches.forEach((entId: string) => this.rejectEntity(entId));
  }

  private rejectAll() {
    this.writer.event('massUpdateStarted').publish();

    const filter = this.getFilter();
    this.writer.entitiesManager.eachEntity((_index: number, entity: Entity) => {
      if (entity.getAttribute('_candidate') === 'true') {
        if (filter === 'all' || filter === entity.getType()) {
          this.rejectEntity(entity.getId());
        }
      }
    });
    this.setFilter('all');

    this.writer.event('massUpdateCompleted').publish();
  }

  private handleDone() {
    this.isConvert = false;
    this.$entities.find('#candidate-entities-title').hide();
    this.$entities.find('.convertActions').hide();
    this.$entities
      .find('button.convert')
      .show()
      //@ts-expect-error
      .button('option', 'disabled', false)
      .next('span')
      .hide();
    this.update();
  }

  // CONVERSION END

  private clear() {
    this.$entities.find('ul').empty();
  }

  private getSorting() {
    return this.$entities.find('select[name="sorting"]').val() as SortingTypes;
  }

  private getMatchesForEntity(entityId: string) {
    const matches: string[] = [];
    const match = this.writer.entitiesManager.getEntity(entityId);

    this.writer.entitiesManager.eachEntity((_index: number, entity: Entity) => {
      if (entity.getId() !== match?.getId()) {
        if (
          JSON.stringify(entity.getAttributes()) === JSON.stringify(match?.getAttributes()) &&
          JSON.stringify(entity.getCustomValues()) === JSON.stringify(match?.getCustomValues()) &&
          entity.getContent() === match?.getContent()
        ) {
          matches.push(entity.getId());
        }
      }
    });

    return matches;
  }

  private getEntityView(entity: Entity) {
    const propertiesHtmlArray: string[] = ['<ul>'];

    // named entity values
    const lemma = entity.getLemma();
    const uri = entity.getURI();
    const createLemmaHTML = () => {
      if (!lemma) return undefined;
      return `<li><strong>Standard</strong>: ${lemma}</li>`;
    };
    const lemmaHTML = createLemmaHTML();
    if (lemmaHTML) propertiesHtmlArray.push(lemmaHTML);

    //URI
    const createUriHTML = () => {
      if (!uri) return undefined;
      return `
        <li>
          <strong>URI</strong>: <a href="${uri}" target="_blank" rel="noopener">${uri}</a>
        </li>
      `;
    };
    const uriHTML = createUriHTML();
    if (uriHTML) propertiesHtmlArray.push(uriHTML);

    // attribute values
    const entityAttributes = entity.getAttributes();
    const urlAttributes = this.writer.schemaManager.mapper.getUrlAttributes();

    for (const name in entityAttributes) {
      if (RESERVED_ATTRIBUTES.has(name)) continue;

      const value = entityAttributes[name];

      if (!value) {
        log.warn(`entitiesList: undefined value for ${name}in `, entity);
        continue;
      }

      if (urlAttributes.indexOf(name) !== -1 || value.indexOf('http') === 0) {
        if (value === uri) continue; // don't duplicate uri

        // if (!attAdded && nevAdded) propertiesHtmlArray.push('<li><hr /></li>');
        propertiesHtmlArray.push(`
          <li>
            <strong>${name}</strong>: <a href="${value}" target="_blank" rel="noopener">${value}</a>
          </li>`);
      } else {
        if (value === lemma) continue; // don't duplicate lemma

        // if (!attAdded && nevAdded) propertiesHtmlArray.push('<li><hr /></li>');
        propertiesHtmlArray.push(`<li><strong>${name}</strong>: ${value}</li>`);
      }
    }

    // custom values
    const customValues = entity.getCustomValues();
    for (const name in customValues) {
      const value = customValues[name];
      propertiesHtmlArray.push(`<li><strong>${name}</strong>: ${value}</li>`);
    }

    propertiesHtmlArray.push('</ul>');

    const isCandidate = entity.getAttribute('_candidate') === 'true';
    let actions = '';

    if (!this.writer.isReadOnly) {
      if (this.isConvert && isCandidate) {
        actions = `
          <span data-action="accept" class="ui-state-default" title="Accept">
            <i class="far fa-check-circle"></i>
          </span>
          <span data-action="reject" class="ui-state-default" title="Reject">
            <i class="fas fa-minus"></i>
          </span>
        `;

        const hasMatching = this.getMatchesForEntity(entity.getId()).length > 0;
        if (hasMatching) {
          actions += `
            <span data-action="acceptmatching" class="ui-state-default" title="Accept All Matching">
              <i class="fas fa-check-circle"></i>
            </span>
          `;
          actions += `
            <span data-action="rejectmatching" class="ui-state-default" title="Reject All Matching">
              <i class="fas fa-minus-circle"></i>
            </span>
          `;
        }
      } else {
        actions = `
          <span data-action="edit" title="Edit">
            <i class="fas fa-pen"></i>
          </span>
          <span data-action="remove" title="Remove">
            <i class="fas fa-minus-circle"></i>
          </span>
        `;
      }
    }

    const id = entity.getId();
    const type = entity.getType();

    return `
      <li
        class="${type} ${isCandidate ? 'candidate' : ''}"
        data-type="${type}"
        data-id="${id}"
      >
        <div id="container">
          <div id="side">
            
            <i class="icon"> ${getSvg(type)}</i>
           
          </div>
          <div id="main">
            <div class="header">
              <span class="entityTitle">${entity.getContent()}</span>
              <div class="actions">${actions}</div>
            </div>
            <div class="info">${propertiesHtmlArray.join('')}</div>
          </div>
        </div>
      </li>
    `;
  }

  private remove(id: string) {
    return this.$entities.find(`li[data-id="${id}"]`).remove();
  }

  convertEntities() {
    const typesToFind = new Set([
      'person',
      'place',
      'org',
      'organization',
      'work',
      'thing',
      'citation',
      'note',
      'date',
      'correction',
      'keyword',
      'link',
    ]);

    const potentialEntitiesByType = this.writer.schemaManager.mapper.findEntities(typesToFind);
    let potentialEntities: HTMLElement[] = [];
    for (const type in potentialEntitiesByType) {
      potentialEntities = [...potentialEntities, ...potentialEntitiesByType[type]];
    }

    // filter out duplicates
    potentialEntities = potentialEntities.filter((value, index, array) => {
      return array.indexOf(value) === index;
    });

    if (potentialEntities.length <= 0) {
      this.writer.dialogManager.show('message', {
        title: 'Entities',
        msg: 'No candidate entities were found.',
        type: 'info',
      });
      return;
    }

    this.isConvert = true;
    this.$entities.find('#candidate-entities-title').show();
    this.$entities.find('.convertActions').show();
    this.$entities
      .find('button.convert')
      .hide()
      //@ts-expect-error
      .button('option', 'disabled', true)
      .next('span')
      .show();

    const li = this.writer.dialogManager.getDialog('loadingindicator');
    li?.setText?.('Converting Entities');
    li?.show();

    this.writer.event('massUpdateStarted').publish();

    this.writer.utilities
      .processArray(potentialEntities, (element: Element) => {
        const entity = this.writer.schemaManager.mapper.convertTagToEntity(element);
        if (entity) {
          entity.setAttribute('_candidate', 'true');
          $(`#${entity.id}`, this.writer.editor?.getBody()).attr('_candidate', 'true');
        }
      })
      .then(() => {
        li?.hide?.();
        this.writer.event('contentChanged').publish();
        this.writer.event('massUpdateCompleted').publish();
      });
  }

  update() {
    if (!this.enabled) {
      this.updatePending = true;
      return;
    }

    this.clear();

    let entities = this.writer.entitiesManager.getEntitiesArray(this.getSorting());

    const filter = this.getFilter();
    if (filter !== 'all') {
      entities = entities.filter((entry: Entity) => entry.getType() === filter);
    }

    let entitiesString = '';
    entities.forEach((entry: Entity) => (entitiesString += this.getEntityView(entry)));

    this.isConvert
      ? this.$entities.find('div.entitiesList').addClass('candidates')
      : this.$entities.find('div.entitiesList').removeClass('candidates');

    this.$entities.find('div.entitiesList').html(entitiesString);

    this.$entities.find('div.entitiesList > li > div').on('click', (event) => {
      const $currentTargetParent = $(event.currentTarget).parent();
      if ($currentTargetParent.hasClass('expanded')) {
        //@ts-expect-error
        $currentTargetParent.toggleClass('expanded', { duration: 200, queue: true });
        return;
      }

      const id = $currentTargetParent.data('id');
      this.writer.entitiesManager.highlightEntity(id, null, true);
    });

    this.$entities.find('.actions > span').on('click', (event) => {
      event.stopPropagation();

      const currentTarget = event.currentTarget;
      const action = $(currentTarget).data('action');
      const id = $(currentTarget).parents('li').data('id');

      switch (action) {
        case 'edit':
          this.writer.tagger.editTagDialog(id);
          break;
        case 'accept':
          this.acceptEntity(id);
          this.update();
          break;
        case 'reject':
          this.rejectEntity(id);
          this.update();
          break;
        case 'remove':
          this.writer.tagger.removeEntity(id);
          break;
        case 'acceptmatching':
          this.acceptMatching(id);
          this.update();
          break;
        case 'rejectmatching':
          this.rejectMatching(id);
          this.update();
          break;
      }
    });

    //@ts-expect-error
    this.$entities.find('.actions').tooltip({
      show: false,
      hide: false,
      classes: { 'ui-tooltip': 'cwrc-tooltip' },
    });

    if (this.writer.entitiesManager.getCurrentEntity()) {
      this.$entities
        .find(`div.entitiesList > li[data-id="${this.writer.entitiesManager.getCurrentEntity()}"]`)
        .addClass('expanded')
        .find('div[class="info"]')
        .show();
    }
  }

  toggleReadonly(readonly: boolean) {
    this.update();
    readonly
      ? this.$entities.find('.moduleFooter').hide()
      : this.$entities.find('.moduleFooter').show();
  }

  enable(forceUpdate: boolean) {
    this.enabled = true;
    if (forceUpdate || this.updatePending) {
      this.update();
      this.updatePending = false;
    }
  }

  disable() {
    this.enabled = false;
  }

  destroy() {
    //@ts-expect-error
    this.$entities.find('button').button('destroy');
    //@ts-expect-error
    this.$entities.find('select').selectmenu('destroy');
    //@ts-expect-error
    this.$entities.find('.actions').tooltip('destroy');
    this.$entities.remove();
  }
}

export default EntitiesList;
