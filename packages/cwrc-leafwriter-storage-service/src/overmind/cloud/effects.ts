import Provider, { ProviderAuth } from '@cwrc/leafwriter-storage-service/types/Provider';

type Providers = Record<string, Provider>;

export class Api {
  providers: Providers = {};

  async initialize(providerAuth: ProviderAuth) {
    if (this.providers[providerAuth.name]) return;

    let module: any;

    if (providerAuth.name === 'github') module = await import('../../providers/Github');
    if (providerAuth.name === 'gitlab') module = await import('../../providers/Gitlab');

    if (!module) return;

    const Provider = module.default;
    const provider: Provider = new Provider(providerAuth);
    const response = await provider.getAuthenticatedUser();
    if (!response) return false;

    this.providers[providerAuth.name] = provider;
    return true;
  }
}

export const api = new Api();
