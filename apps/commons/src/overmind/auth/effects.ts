import { contract, type LinkedAccountsBodyOutputs } from '@lincs.project/auth-api-contract';
import { Provider } from '@src/services';
import { log } from '@src/utilities';
import { initClient } from '@ts-rest/core';
import axios from 'axios';
import i18next from 'i18next';
import Keycloak, { type KeycloakTokenParsed } from 'keycloak-js';
import { logHttpError } from '../../services/utilities';

const { t } = i18next;

//* Documentation: https://github.com/keycloak/keycloak-documentation/blob/master/securing_apps/topics/oidc/javascript-adapter.adoc

export interface HTTPRequestError {
  error: {
    status?: number;
    message: string;
  };
}

export type LinkedAccounts = LinkedAccountsBodyOutputs;
export type LinkedAccount = LinkedAccounts[0];

interface tokenParsed extends KeycloakTokenParsed {
  identity_provider?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  preferred_username?: string;
}

/* The Api class is a wrapper for the Keycloak object that provides a set of functions that are used to
authenticate the user and get the user's profile data */

// The LINCS auth contract is not typed against this client; its calls are checked at runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
const getLincsAuthApi = (baseUrl: string) =>
  initClient(contract as any, { baseUrl, baseHeaders: {} }) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class Api {
  readonly clientId: string;
  readonly LINK_ACCOUNTS_CALLBACK_URL: string;
  readonly realm: string;

  private KEYCLOACK_BASE_URL!: string;
  private AUTH_API_URL!: string;

  private keycloak!: Keycloak;

  /**
   * The constructor function is called when the class is instantiated. It sets the realm, clientId,
   * and LINK_ACCOUNTS_CALLBACK_URL variables
   */
  constructor() {
    this.realm = 'lincs';
    this.clientId = 'leaf-writer';

    const { origin } = window.location;
    this.LINK_ACCOUNTS_CALLBACK_URL = `${origin}/link-accounts`;
  }

  /**
   * Setup the API
   */
  async setup() {
    this.KEYCLOACK_BASE_URL = await this.getExternalServiceUrl('keycloak');
    if (!this.KEYCLOACK_BASE_URL) throw log.error('Failed to configure KEYCLOACK_BASE_URL');

    this.AUTH_API_URL = await this.getExternalServiceUrl('auth-api');
    if (!this.AUTH_API_URL) throw log.error('Failed to configure AUTH_API_URL');

    this.keycloak = new Keycloak({
      clientId: this.clientId,
      realm: this.realm,
      url: `${this.KEYCLOACK_BASE_URL}`,
    });
  }

  /**
   * It initializes the keycloak object and returns a promise that resolves to true if the user is authenticated
   * @returns A promise that resolves to a boolean.
   */
  async init() {
    const { origin } = window.location;

    const sessionAuthenticated = await this.keycloak
      .init({
        onLoad: 'check-sso',
        pkceMethod: 'S256',
        silentCheckSsoRedirectUri: `${origin}/silent-check-sso.html`,
      })
      .catch(() => log.error('Failed to contact keycloak'));

    return sessionAuthenticated;
  }

  /**
   * It makes an HTTP request to the server, and returns the URL of the external service
   * @param {string} service - The name of the service you want to get the URL for.
   * @returns The URL of the external service.
   */
  async getExternalServiceUrl(service: string) {
    const { data } = await axios.get<string>(`./api/${service}-url`);
    return data;
  }

  /**
   * The login function will redirect the user to the Keycloak login page, and once the user is
   * authenticated, the user will be redirected back to the application
   * @returns The login method returns a promise that resolves to a boolean value.
   */
  async login(options?: { idpHint?: string }) {
    return await this.keycloak.login({
      ...options,
      redirectUri: window.location.href,
    });
  }

  /**
   * It logs the user out of the application.
   */
  async logout() {
    await this.keycloak.logout();
  }

  /**
   * It returns the token from the keycloak object
   * @returns The token.
   */
  async getToken() {
    if (this.isTokenExpired()) await this.updateToken();
    return this.keycloak.token;
  }

  /**
   * This function returns a boolean value that the user is logged in based on the presence of their token
   * @returns A boolean value.
   */
  isLoggedIn() {
    return !!this.keycloak.token;
  }

  /**
   * This function returns a boolean value that indicates whether the token is expired or not
   * @returns A boolean value.
   */
  isTokenExpired() {
    return this.keycloak.isTokenExpired();
  }

  /**
   * It updates the token, and if it fails, it clears the token and alerts the user
   * @returns A promise that resolves to a boolean value.
   */
  async updateToken() {
    return await this.keycloak.updateToken(5).catch(() => {
      alert(t('LWC.auth.token_refresh_failed'));
      this.keycloak.clearToken();
    });
  }

  /**
   * It returns the identity provider of the user that is currently logged in
   * @returns The identity provider of the user.
   */
  getIdentityProvider() {
    const tokenParsed = this.keycloak.tokenParsed as tokenParsed;
    return tokenParsed.identity_provider;
  }

  /**
   * It returns the user profile data from the Keycloak server
   * @returns The user profile.
   */
  async getUserData() {
    if (!this.keycloak.tokenParsed) return;
    const userProfile = await this.keycloak.loadUserProfile();
    return userProfile;
  }

  /**
   * It returns true if the user has any of the roles passed in the array
   * @param {string[]} roles - string[] - an array of roles that the user must have at least one of
   * @returns A boolean value.
   */
  userHasRole(roles: string[]) {
    return roles.some((role) => this.keycloak.hasRealmRole(role));
  }

  /**
   * This function returns a boolean value that indicates whether the user has the specified role for
   * the specified resource
   * @param {string} role - The role you want to check for.
   * @param {string} [resource] - The name of the resource.
   * @returns A boolean value.
   */
  userHasResourceRole(role: string, resource?: string) {
    return this.keycloak.hasResourceRole(role, resource);
  }

  /**
   * It returns the account management URL.
   * @returns The account management API.
   */
  accountManagement() {
    return this.keycloak.accountManagement();
  }

  /**
   * It takes a provider alias and a keycloak access code and returns the external Identity Provider (IDP) tokens
   * @param {string} provider_alias - The alias of the external identity provider.
   * @param {string} keycloakAccessCode - This is the access code that you get from the Keycloak server
   * when you authenticate with the external IDP.
   * @returns The access token for the external IDP.
   */
  async getExternalIDPTokens(
    provider_alias: string,
    keycloakAccessCode: string,
  ): Promise<string | Record<string, unknown> | Error> {
    try {
      const url = `${this.KEYCLOACK_BASE_URL}/realms/${this.realm}/broker/${provider_alias}/token`;
      const { data } = await axios.get<string | Record<string, unknown>>(url, {
        headers: { Authorization: `Bearer ${keycloakAccessCode}` },
      });
      return data;
    } catch (error) {
      logHttpError(error);
      if (axios.isAxiosError(error)) {
        return new Error(error.message);
      }
      return new Error('error');
    }
  }

  /**
   * This function takes a Keycloak access code and returns a list of linked accounts
   * @param {string} keycloakAccessCode - The access code that was returned from the Keycloak login.
   * @returns An array of linked accounts
   */
  async getLinkedAccounts(
    keycloakAccessCode: string,
    username: string,
  ): Promise<LinkedAccount[] | HTTPRequestError> {
    if (!this.AUTH_API_URL) {
      return { error: { message: t('LWC.auth.api_base_url_undefined') } };
    }

    const authApi = getLincsAuthApi(this.AUTH_API_URL);
    const { body, status } = await authApi.users.getLinkedAccounts({
      headers: { authorization: `Bearer ${keycloakAccessCode}` },
      params: { username },
    });

    if (status === 401 || status === 404 || status === 500) {
      console.warn(body.message);
      return {
        error: { status, message: `${t('LWC.auth.linked_accounts_prefix')} ${body.message}` },
      };
    }

    if (status !== 200) {
      console.warn({ error: 'something went wrong' });
      return {
        error: {
          status: status,
          message: `${t('LWC.auth.linked_accounts_prefix')} ${t('LWC.auth.something_went_wrong')}`,
        },
      };
    }

    return body;
  }

  /**
   * This function takes an identity provider and a keycloak access code and returns a link account URL
   * @param {string} identity_provider - The name of the identity provider you want to link to.
   * @param {string} keycloakAccessCode - The access code that you get from the Keycloak server when
   * you log in.
   * @returns A promise that resolves to a string or an IHTTPRequestError
   */
  async getLinkAccountUrl({
    username,
    provider,
    keycloakAccessCode,
  }: {
    username: string;
    provider: string;
    keycloakAccessCode: string;
  }): Promise<string | HTTPRequestError> {
    if (!this.AUTH_API_URL) {
      return { error: { message: t('LWC.auth.api_url_undefined') } };
    }

    const authApi = getLincsAuthApi(this.AUTH_API_URL);
    const { body, status } = await authApi.users.getLinkAccountUrl({
      headers: { authorization: `Bearer ${keycloakAccessCode}` },
      params: { username },
      query: {
        provider,
        redirectUri: this.LINK_ACCOUNTS_CALLBACK_URL,
      },
    });

    if (status === 401 || status === 404 || status === 500) {
      console.warn(body.message);
      return {
        error: {
          status: status,
          message: `${t('LWC.auth.link_account_url_prefix')} ${body.message}`,
        },
      };
    }

    if (status !== 200) {
      console.warn({ error: 'something went wrong' });
      return {
        error: {
          status,
          message: `${t('LWC.auth.link_account_url_prefix')} ${t('LWC.auth.something_went_wrong')}`,
        },
      };
    }

    return body.url;
  }

  async getProviders(): Promise<Provider[] | Error> {
    if (!this.AUTH_API_URL) {
      return new Error('AUTH API URL is unedefined');
    }

    const authApi = getLincsAuthApi(this.AUTH_API_URL);
    const { body, status } = await authApi.providers.getAll();

    if (status === 200) return body;

    if (status === 500) {
      console.warn(status, body.message);
      return [];
    }

    return new Error('error');
  }
}

export const api = new Api();
