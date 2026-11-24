import { Typography } from '@mui/material';
import { TextEmphasis } from '@src/components';
import { useActions, useAppState } from '@src/overmind';
import { isDesktop } from '@src/types/desktop';
import { useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAnalytics } from '..';

import 'vanilla-cookieconsent';
import './cookieConsent.css';

let cookieConsent: CookieConsent;

export const useCookieConsent = () => {
  const { auth, editor, ui } = useAppState();

  const { signOut } = useActions().auth;
  const { setCookieConsent, openDialog } = useActions().ui;

  const { t } = useTranslation();

  const { stopAnalytics } = useAnalytics();

  const handleClickPrivacyPolicy = () => {
    if (!cookieConsent) return;
    cookieConsent.hideSettings();
    openDialog({ type: 'privacy' });
  };

  useEffect(() => {
    if (isDesktop()) return;

    if (!cookieConsent) {
      cookieConsent = window.initCookieConsent();
      initialize();
    }

    const linkPrivacyPolicy = document.getElementById('linkToPrivacyPolicy');
    if (linkPrivacyPolicy) linkPrivacyPolicy.onclick = handleClickPrivacyPolicy;
    // Runs once: it creates the global cookie-consent widget and wires the
    // privacy-policy link. Re-running would initialise the widget a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beforeRemoveBasicConsent = (cookie: SavedCookieContent) => {
    if (auth.userState == 'AUTHENTICATED') {
      openDialog({
        props: {
          severity: 'warning',
          title: `${t('LWC.cookie consent.privacy_settings')}`,
          Body: () => (
            <>
              <Typography>
                <Trans i18nKey="LWC.cookie consent.warning.remove_consent_basic_interactions_message">
                  <Typography component="span">Removing consent for </Typography>
                  <TextEmphasis color="warning">
                    {`Basic interactions & functionalities`}
                  </TextEmphasis>
                  <Typography component="span">will sign you out.</Typography>
                </Trans>
              </Typography>
              {ui.page === 'edit' && editor.contentHasChanged && (
                <Typography>{t('LWC.storage.you_will_lose_any_unsaved_changes')}.</Typography>
              )}
            </>
          ),
          actions: [
            { action: 'cancel', label: `${t('LWC.commons.cancel')}`, variant: 'outlined' },
            {
              action: 'signout',
              label: `${t('LWC.cookie consent.remove consent')} ${t('LWC.commons.and')} ${t(
                'LWC.commons.sign_out',
              )}`,
            },
          ],
          onClose: async (action) => {
            if (action === 'cancel') {
              //restablish categories
              cookieConsent.accept([...cookie.categories, 'interaction']);
              return;
            }

            clearCookieConsent();
            signOut();
          },
        },
      });
    }
  };

  const initialize = () => {
    cookieConsent.run({
      current_lang: 'en-CA',
      autoclear_cookies: true, // default: false
      // force_consent: false,                   // default: false
      // cookie_expiration: 182,                 // default: 182 (days)
      // cookie_necessary_only_expiration: 182   // default: disabled
      // revision: 0,                            // default: 0

      onFirstAction: (_user_preferences, cookie) => {
        setCookieConsent(cookie.categories);
      },

      onAccept: (cookie) => {
        setCookieConsent(cookie.categories);
      },

      onChange: (cookie, _changed_preferences) => {
        setCookieConsent(cookie.categories);

        if (!cookie.categories.includes('measurement')) stopAnalytics();

        if (!cookie.categories.includes('interaction')) {
          beforeRemoveBasicConsent(cookie);
        }
      },

      gui_options: {
        consent_modal: {
          layout: 'bar',
          transition: 'slide',
        },
        settings_modal: {
          layout: 'box',
          transition: 'slide',
        },
      },

      languages: {
        'en-CA': {
          //@ts-expect-error -- the library's translation typings are narrower than this content
          consent_modal: consentModalContent('en-CA'),
          //@ts-expect-error -- the library's translation typings are narrower than this content
          settings_modal: consentSettingsContent('en-CA'),
        },
        'fr-CA': {
          //@ts-expect-error -- the library's translation typings are narrower than this content
          consent_modal: consentModalContent('fr-CA'),
          //@ts-expect-error -- the library's translation typings are narrower than this content
          settings_modal: consentSettingsContent('fr-CA'),
        },
      },
    });

    return cookieConsent;
  };

  const consentModalContent = (lng: string) => {
    const pStyle = 'margin-bottom: 8px';
    return {
      title: `${t('LWC.cookie consent.consent_banner.we_use_cookies', { lng })}!`,
      description: `
    <p style="${pStyle}">${t('LWC.cookie consent.consent_banner.line1', { lng })}</p>
    <p style="${pStyle}">${t('LWC.cookie consent.consent_banner.line2', { lng })}</p>
    <p style="${pStyle}">${t('LWC.cookie consent.consent_banner.line3', { lng })}</p>
    <button type="button" data-cc="c-settings" class="cc-link">${t(
      'LWC.cookie consent.consent_banner.let_me_choose',
    )}</button>`,
      primary_btn: {
        text: t('LWC.commons.accept_all', { lng }),
        role: 'accept_all', // 'accept_selected' or 'accept_all'
      },
      secondary_btn: {
        text: t('LWC.commons.reject_all', { lng }),
        role: 'accept_necessary', // 'settings' or 'accept_necessary'
      },
    };
  };

  const consentSettingsContent = (lng: string) => ({
    title: t('LWC.cookie consent.settings_modal.consent_preferences', { lng }),
    save_settings_btn: t('LWC.commons.save', { lng }),
    accept_all_btn: t('LWC.commons.accept_all', { lng }),
    reject_all_btn: t('LWC.commons.reject_all', { lng }),
    close_btn_label: t('LWC.commons.close', { lng }),
    cookie_table_headers: [
      { col1: t('LWC.commons.name', { lng }) },
      { col2: t('LWC.cookie consent.settings_modal.domain', { lng }) },
      { col3: t('LWC.cookie consent.settings_modal.expiration', { lng }) },
      { col4: t('LWC.commons.description', { lng }) },
    ],
    blocks: [
      {
        title: `${t('LWC.cookie consent.settings_modal.cookie_usage', { lng })}  📢`,
        description: `<span> ${t('LWC.cookie consent.settings_modal.cookie_usage_description', {
          lng,
        })} <span id="linkToPrivacyPolicy" class="cc-link">${t('LWC.commons.privacy_policy', {
          lng,
        })}</span>.</span>`,
      },
      {
        title: t('LWC.cookie consent.settings_modal.strictly_necessary', { lng }),
        //e.g., Backup saving and management, Hosting and backend infrastructure, Managing landing and invitation pages, Platform services and hosting, SPAM protection, Traffic optimization and distribution, Infrastructure monitoring, Handling payments
        description: t('LWC.cookie consent.settings_modal.strictly_necessary_description', { lng }),
        toggle: {
          value: 'necessary',
          enabled: true,
          readonly: true, // cookie categories with readonly=true are all treated as "necessary cookies"
        },
        cookie_table: [
          // list of all expected cookies
          {
            col1: 'cc_cookie',
            col2: location.hostname,
            col3: t('LWC.cookie consent.settings_modal.cookie_expiration_time', {
              lng,
              value: 6,
              period: 'months',
            }),
            col4: t('LWC.cookie consent.settings_modal.cc_cookie_description', { lng }),
          },
        ],
      },
      {
        title: `${t('LWC.commons.basic_interactions', { lng })} & ${t(
          'LWC.commons.functionalities',
          { lng },
        )}`,
        //e.g., Contacting the User, Interaction with live chat platforms Managing web conferencing and online telephony, Managing support and contact requests, Interaction with support and feedback platforms, Tag Management, Registration and authentication, User database management
        description: `<span>${t('LWC.cookie consent.settings_modal.basic_interactions_description', { lng })}</span> 
        <span>${t('LWC.cookie consent.settings_modal.basic_interactions_description2', { lng })} <a href="https://docs.github.com/en/site-policy/privacy-policies/github-cookies" target="_blank" rel="noopener noreferrer" class="cc-link">${t(
          'LWC.cookie consent.settings_modal.list of cookies used by GitHub',
          { lng },
        )}</a>.</span>
        `,
        toggle: { value: 'interaction', enabled: true, readonly: false },
        cookie_table: [
          // list of all expected cookies
          {
            col1: 'AUTH_SESSION_',
            col2: 'lincsproject.ca',
            col3: t('LWC.commons.session', { lng }),
            col4: t('LWC.cookie consent.settings_modal.AUTH_SESSION_description', { lng }),
            is_regex: true,
          },
          {
            col1: 'KEYCLOAK_IDENTITY*',
            col2: 'lincsproject.ca',
            col3: t('LWC.cookie consent.settings_modal.cookie_expiration_time', {
              lng,
              value: 1,
              period: 'year',
            }),
            col4: t('LWC.cookie consent.settings_modal.AUTH_SESSION_description', { lng }),
            is_regex: true,
          },
          {
            col1: 'KEYCLOAK_SESION*',
            col2: 'lincsproject.ca',
            col3: t('LWC.commons.session', { lng }),
            col4: t('LWC.cookie consent.settings_modal.AUTH_SESSION_description', { lng }),
            is_regex: true,
          },
        ],
      },
      {
        title: t('LWC.cookie consent.settings_modal.measurement', { lng }),
        // e.g., Analytics, Beta testing, Content performance and feature testing (A/B testing), Heat mapping and session recording, Managing data collection and online surveys
        description: t('LWC.cookie consent.settings_modal.measurement_description', { lng }),
        toggle: {
          value: 'measurement',
          enabled: false,
          readonly: false,
        },
        cookie_table: [
          {
            col1: '_ga_#', // match all cookies starting with "_ga"
            col2: 'google.com',
            col3: t('LWC.cookie consent.settings_modal.cookie_expiration_time', {
              lng,
              value: 1,
              period: 'year',
            }),
            col4: t('LWC.cookie consent.settings_modal._ga_description', { lng }),
            is_regex: true,
          },
        ],
      },
      {
        title: t('LWC.commons.more_information', { lng }),
        description: `<p> ${t('LWC.cookie consent.settings_modal.more_information_description', {
          lng,
        })} ${t('LWC.commons.please', {
          lng,
        })},  <a href="mailto:cwrc-leaf@ualberta.ca" class="cc-link">${t('LWC.commons.contact_us', {
          lng,
        })}</a>.</p>`,
      },
    ],
  });

  const clearCookieConsent = () => {
    if (!cookieConsent) return;
    stopAnalytics();
    cookieConsent.eraseCookies(['cc_cookie']);
    setCookieConsent();
  };

  const eraseCookies = (cookies: string[]) => {
    if (!cookieConsent) return;
    cookieConsent.eraseCookies(cookies);
  };

  const showSettings = () => {
    if (!cookieConsent) return;
    cookieConsent.showSettings(0);
  };

  const switchLanguage = (locale: string) => {
    if (!cookieConsent) return;
    cookieConsent.updateLanguage(locale, true);
  };

  return {
    clearCookieConsent,
    cookieConsent,
    eraseCookies,
    showSettings,
    switchLanguage,
  };
};
