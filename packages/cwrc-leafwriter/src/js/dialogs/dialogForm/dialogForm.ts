import $ from 'jquery';
import 'jquery-ui/ui/widgets/button';
import 'jquery-ui/ui/widgets/controlgroup';
import 'jquery-ui/ui/widgets/dialog';
import 'jquery-ui/ui/widgets/selectmenu';
import Entity from '../../../js/entities/Entity';
import Writer from '../../Writer';
import AttributeWidget from '../attributeWidget/attributeWidget';

type DialogType =
  | 'person'
  | 'citation'
  | 'correction'
  | 'date'
  | 'keyword'
  | 'link'
  | 'organization'
  | 'place'
  | 'work'
  | 'note'
  | 'thing'
  | 'concept';

interface DialogFormConfig {
  writer: Writer;
  $el: JQuery<HTMLElement>;
  title: string;
  height?: number;
  width?: number;
  cwrcWriterConfig?: any;
  type: DialogType;
}

interface DialogFormShowConfig {
  [x: string]: any;
  entry?: Entity;
}

interface CurrentDataProps {
  attributes: any;
  properties: any;
  customValues: any;
}

class DialogForm {
  static ADD = 0 as const;
  static EDIT = 1 as const;

  readonly writer: Writer;
  readonly $el: JQuery<HTMLElement>;
  showConfig?: DialogFormShowConfig; // the config object sent to the dialog's "show" method

  leafWriter?: any; // reference to the leafWriter if this is a note form

  // set to false to cancel saving
  isValid = true;
  type: DialogType;
  mode: typeof DialogForm.ADD | typeof DialogForm.EDIT | null = null;

  currentId: string | null = null;

  currentData: CurrentDataProps = {
    attributes: {},
    properties: {},
    customValues: {},
  };

  attributesWidget?: AttributeWidget;

  attWidgetInit = false;

  static processForm(dialogInstance: DialogForm) {
    const data = dialogInstance.currentData;

    // process attributes first, since other form elements should override them if there's a discrepancy
    if (
      dialogInstance.attributesWidget &&
      $('[data-type="attributes"]', dialogInstance.$el).length === 1
    ) {
      const atts = dialogInstance.attributesWidget.getData();
      $.extend(data.attributes, atts);
    }

    $('[data-type]', dialogInstance.$el)
      .not('[data-type="attributes"]')
      .each((_index, element) => {
        const formEl = $(element);

        if (formEl.parents('.cwrcDialogWrapper').length === 1) {
          // ignore child forms inserted by note mini-writers
          const type = formEl.data('type');
          let mapping = formEl.data('mapping');

          if (mapping) {
            let dataKey = 'attributes';
            const isCustom = mapping.indexOf('custom.') === 0;
            const isProperty = mapping.indexOf('prop.') === 0;

            if (isCustom) {
              mapping = mapping.replace(/^custom\./, '');
              dataKey = 'customValues';
            } else if (isProperty) {
              mapping = mapping.replace(/^prop\./, '');
              dataKey = 'properties';
            }

            let val;
            switch (type) {
              case 'radio':
                val = formEl.find('input:checked').val();

                //@ts-expect-error
                data[dataKey][mapping] = val;
                break;
              case 'textbox':
              case 'hidden':
              case 'select':
                val = formEl.val();

                //@ts-expect-error
                if (val !== null) data[dataKey][mapping] = val;
                break;
            }
          }
        }
      });

    for (const key in data.attributes) {
      if (data.attributes[key] === undefined || data.attributes[key] === '') {
        delete data.attributes[key];
      }
    }
  }

  static populateForm(dialogInstance: DialogForm) {
    const data = dialogInstance.currentData;

    $('[data-type]', dialogInstance.$el)
      .filter((_index, element) => {
        // don't include form elements from note entity children
        return $(element).parents('.cwrcWrapper').length === 1;
      })
      .each(function (_index, _element) {
        const formEl = $(this);
        const type = formEl.data('type');

        if (type === 'attributes') {
          if (dialogInstance.attributesWidget) {
            dialogInstance.attributesWidget.setData(data.attributes);
            // if (showWidget) dialogInstance.attributesWidget.expand();
          }
        } else {
          let mapping = formEl.data('mapping');
          if (!mapping) return;

          let value;
          const isCustom = mapping.indexOf('custom.') === 0;
          const isProperty = mapping.indexOf('prop.') === 0;

          if (isCustom) {
            mapping = mapping.replace(/^custom\./, '');
            value = data.customValues[mapping];
          } else if (isProperty) {
            mapping = mapping.replace(/^prop\./, '');
            value = data.properties[mapping];
          } else {
            value = data.attributes[mapping];
          }

          if (mapping === 'otherType') value = data.attributes.type;
          if (!value) return;

          switch (type) {
            case 'select':
              // eslint-disable-next-line no-case-declarations
              const selectedOption = $(`option[value="${value}"]`, formEl);
              if (!selectedOption[0]) value = 'other'; //if there is no option for the value, select 'other' option
              formEl.val(value);

              //@ts-expect-error
              if (formEl.data('transform') === 'selectmenu') formEl.selectmenu('refresh');
              // formEl.parents('[data-transform="accordion"]').accordion('option', 'active', 0);
              break;

            case 'radio':
              // eslint-disable-next-line no-case-declarations
              let radioOption = $(`input[value="${value}"]`, formEl);
              if (!radioOption[0]) radioOption = $('input[value="other"]', formEl); //if there is no option for the value, check 'other' option
              radioOption.trigger('click');

              // if (formEl.data('transform') === 'buttonset') $('input', formEl).button('refresh');
              break;

            case 'textbox':
              formEl.val(value);
              break;

            case 'label':
              formEl.html(value);
              break;
          }
        }
      });
  }

  constructor(config: DialogFormConfig) {
    this.writer = config.writer;
    this.$el = config.$el;

    this.type = config.type;

    const title = config.title;
    const height = config.height || 650;
    const width = config.width || 575;

    // this.cwrcWriterConfig = config.cwrcWriterConfig; // the config to use for the leafWriter

    this.$el.dialog({
      title,
      modal: true,
      resizable: true,
      dialogClass: 'splitButtons',
      closeOnEscape: false,
      open: (_event: JQuery.Event, _ui: unknown) => {
        this.$el.parent().find('.ui-dialog-titlebar-close').hide();
      },
      height,
      width,
      position: { my: 'center', at: 'center', of: this.writer.layoutManager.getContainer() },
      autoOpen: false,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          click: () => {
            this.$el.trigger('beforeCancel');
            this.$el.trigger('beforeClose');
            this.$el.dialog('close');
          },
        },
        {
          text: 'Ok',
          role: 'ok',
          click: () => this.save(),
        },
      ],
    });

    $('[data-transform]', this.$el).each((_index, element) => {
      const formEl = $(element);
      const transform = formEl.data('transform');

      switch (transform) {
        //! buttonset is deprecated, but there are yet a few instances in the code. Use 'controlgroup' instead
        // case 'buttonset':
        //   //@ts-expect-error
        //   formEl.controlgroup({ icon: false });
        //   break;
        case 'controlgroup':
          //@ts-expect-error
          formEl.controlgroup({ icon: false });
          break;
        // case 'accordion':
        //   //@ts-expect-error
        //   formEl.accordion({
        //     heightStyle: 'content',
        //     animate: false,
        //     collapsible: true,
        //     active: false,
        //   });
        //   break;
        case 'selectmenu':
          //@ts-expect-error
          formEl.selectmenu({
            appendTo: this.writer.layoutManager.getContainer(),
          });
      }
    });

    $('[data-type="attributes"]', this.$el)
      .first()
      .each((_index, element) => {
        this.attributesWidget = new AttributeWidget({
          writer: this.writer,
          $parent: this.$el,
          $el: $(element),
        });
        this.attWidgetInit = false;
      });
  }

  private initAttributeWidget(dialogInstance: DialogForm, config: DialogFormShowConfig) {
    const tagName = config.entry
      ? config.entry.tag
      : dialogInstance.writer.schemaManager.mapper.getParentTag(dialogInstance.type);
    if (!tagName) return;

    const atts = dialogInstance.writer.schemaManager.getAttributesForTag(tagName);
    if (dialogInstance.attributesWidget) {
      dialogInstance.attributesWidget.buildWidget({ atts, isEntity: true, tagName });
    }
    dialogInstance.attWidgetInit = true;
  }

  show(config: DialogFormShowConfig = {}) {
    this.showConfig = config;
    this.mode = config.entry ? DialogForm.EDIT : DialogForm.ADD;

    if (this.attributesWidget) {
      if (!this.attWidgetInit) this.initAttributeWidget(this, config);
      this.attributesWidget.reset();
    }

    this.$el.trigger('buildDynamicFields', [config, this]);

    // reset the form
    $('[data-type]', this.$el).each((_index, element) => {
      const formEl = $(element);
      const type = formEl.data('type');

      switch (type) {
        case 'radio':
          //@ts-expect-error
          formEl.find('input').checkboxradio({ icon: false });
          formEl.find('input').prop('checked', false); // reset all
          formEl.find('[data-default]').prop('checked', true); // set default if it exists
          break;
        case 'textbox':
        case 'select':
          formEl.val('');
          if (formEl.data('transform') === 'selectmenu') {
            //@ts-expect-error
            formEl.selectmenu('refresh');
          }
          break;
        case 'label':
          formEl.empty();
          break;
        case 'hidden':
          // do nothing for hidden
          break;
      }
    });

    // if we have an entity dialog inside a note entity, we need to stop the parent note entity from also receiving close and save events
    this.$el.one('beforeClose', (event) => event.stopPropagation());
    this.$el.one('beforeSave', (event) => event.stopPropagation());

    this.currentData = {
      attributes: {},
      properties: {},
      customValues: {},
    };

    const mappedProps = this.writer.schemaManager.mapper.getMappedProperties(this.type);

    if (this.mode === DialogForm.ADD) {
      // copy properties over
      $.extend(this.currentData.properties, config.properties);

      // map property values to attributes
      mappedProps?.forEach((propName) => {
        const propVal = this.currentData.properties[propName];
        const propMapping = this.writer.schemaManager.mapper.getAttributeForProperty(
          this.type,
          propName,
        );

        if (propVal && propMapping) {
          this.currentData.attributes[propMapping] = propVal;
        }
      });
    }

    if (config.entry && this.mode === DialogForm.EDIT) {
      this.currentId = config.entry.getId();

      // clone attributes and custom values, then unescaping the values
      const attributes = Object.assign({}, config.entry.getAttributes());

      for (const key in attributes) {
        attributes[key] = this.writer.utilities.unescapeHTMLString(attributes[key]);
      }

      const customValues = JSON.parse(JSON.stringify(config.entry.getCustomValues()));

      for (const key in customValues) {
        const val = customValues[key];
        if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            customValues[key][i] = this.writer.utilities.unescapeHTMLString(val[i]);
          }
        } else if ($.isPlainObject(val)) {
          for (const subkey in val) {
            customValues[key][subkey] = this.writer.utilities.unescapeHTMLString(val[subkey]);
          }
        } else {
          customValues[key] = this.writer.utilities.unescapeHTMLString(val);
        }
      }

      this.currentData.attributes = attributes;
      this.currentData.customValues = customValues;
      this.currentData.properties = {
        tag: config.entry.tag,
        type: config.entry.type,
      };

      // copy mapped properties to currentData
      mappedProps?.forEach((propName) => {
        //@ts-expect-error
        this.currentData.properties[propName] = config.entry?.[propName];
      });
    }

    DialogForm.populateForm(this);
    this.$el.trigger('beforeShow', [config, this]);

    this.$el.dialog('open');
  }

  save() {
    this.$el.trigger('beforeSave', [this]);
    if (!this.isValid) return;

    DialogForm.processForm(this);

    if (this.isValid) {
      this.$el.trigger('beforeClose');
      this.$el.dialog('close');

      if (this.mode === DialogForm.EDIT && this.currentData && this.currentId) {
        this.writer.tagger.editEntity(this.currentId, this.currentData);
      } else {
        this.writer.tagger.finalizeEntity(this.type, this.currentData);
      }
      this.$el.trigger('save', [this]);
    }
  }

  destroy() {
    if (this.attributesWidget) this.attributesWidget.destroy();
    if (this.leafWriter) this.leafWriter.destroy();

    $('[data-transform]', this.$el).each((_index, element) => {
      const formEl = $(element);

      // check to see if the control has been instantiated
      const uiInstance = Object.keys(formEl.data()).find((key) => {
        // instance stored in key that starts with "ui"
        return key.startsWith('ui');
      });

      if (uiInstance) {
        const transform = formEl.data('transform');
        switch (transform) {
          // //buttonset is deprecated, but there are yet a few instances in the code. Use 'controlgroup' instead
          // case 'buttonset':
          //   formEl.controlgroup('destroy');
          //   break;
          case 'controlgroup':
            //@ts-expect-error
            formEl.controlgroup('destroy');
            break;
          // case 'accordion':
          //   formEl.accordion('destroy');
          //   break;
          case 'selectmenu':
            //@ts-expect-error
            formEl.selectmenu('destroy');
            break;
        }
      }
    });

    this.$el.remove();
  }
}

export default DialogForm;
