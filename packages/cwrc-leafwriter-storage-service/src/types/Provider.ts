import type { CollectionSource, Organization, PublicRepository, Repository, UserType } from '.';
import type { Error } from '../types';

export interface ProviderAuth {
  access_token: string;
  name: string;
}

export interface UserDetailParams {
  type?: string;
  user: string;
}

export interface PaginatorParams {
  nextPage?: string;
  per_page?: number;
}

export interface ReposParams extends PaginatorParams {
  collectionSource?: CollectionSource;
}

export interface ReposForUserParams extends ReposParams {
  username: string;
}

export interface RepoParams {
  checkForkStatus?: boolean;
  repoId: string;
  repoName: string;
  username: string;
}

export interface ReposForOrgsParams extends PaginatorParams {
  orgId?: string;
  orgUsername?: string;
}

export interface RepoBranchesParams extends PaginatorParams {
  repoName: string;
  repoId: string | number;
  owner?: string;
  search?: string;
}

export interface RepoContentParams {
  branch: string;
  ownerUsername?: string;
  path?: string;
  repoId?: string;
  repoName?: string;
}

export interface DocumentDetails {
  content: string;
  hash: string;
  url: string;
  urlApi?: string;
}

export interface GetLatestCommitParams {
  ownerUsername?: string;
  path?: string;
  repoId?: string;
  repoName?: string;
}

export interface LatestCommit {
  authorEmail?: string;
  authorName?: string;
  date?: string;
  relativeDate?: string;
  html_url: string;
  message: string;
}

export interface SearchUserParams {
  query: string;
}

export interface SearchBlobsParams {
  extension?: string;
  owner: string;
  query: string;
  repoId?: string;
}

export interface CreateRepoParams {
  description?: string;
  isPrivate?: boolean;
  name: string;
  orgId?: string;
  orgName?: string;
  userId?: string;
}

export interface CheckOrgMemberWrittenPermission {
  orgId?: string;
  orgName?: string;
  userId?: string;
  username?: string;
}

export interface CheckRepoUserWrittenPermission {
  ownerId?: string;
  ownerUsername?: string;
  repoId?: string;
  repoName?: string;
  userId?: string;
  username?: string;
}

export interface GetOrganization {
  orgId?: string;
  orgName?: string;
}

export interface SaveDocument {
  branch: string;
  content: string;
  hash?: string;
  message: string;
  ownerUsername?: string;
  path: string;
  repoId?: string;
  repoName?: string;
}

export interface CreateFork {
  orgName?: string;
  ownerUsername: string;
  repoId: string;
  repoName: string;
}

export interface CreateBranch {
  branchOrigin: string;
  branchTarget: string;
  ownerUsername?: string;
  repoId?: string;
  repoName?: string;
}

export interface GetBranch {
  branch: string;
  ownerUsername?: string;
  repoId?: string;
  repoName?: string;
}

export interface CreatePrParams {
  branchOrigin: string;
  branchHead: string;
  origin: Repository;
  ownerUsername: string;
  title: string;
}

export interface CreatePrFromForkProps {
  fork: Repository;
  origin: Repository;
  title: string;
}

export interface ProviderError extends Error {
  status: number;
}

export type CreatePrResponse = 'created' | 'exists' | null;

export interface AuthenticatedUser {
  id: string;
  userId: string;
  username: string;
  type: UserType;

  [key: string]: any;
}

export default interface Provider {
  readonly name: string;
  userId: string;
  username: string;

  checkForBranch: (params: GetBranch) => Promise<boolean>;
  checkOrgMemberWritenPermission: (params: CheckOrgMemberWrittenPermission) => Promise<boolean>;
  checkRepoUserWritenPermission: (params: CheckRepoUserWrittenPermission) => Promise<boolean>;
  createBranch: (params: CreateBranch) => Promise<any>;
  createFolder: (params: SaveDocument) => Promise<any>;
  createFork: (params: CreateFork) => Promise<Repository>;
  createPullRequest: (params: CreatePrParams) => Promise<CreatePrResponse>;
  createPullRequestFromFork: (params: CreatePrFromForkProps) => Promise<CreatePrResponse>;
  createRepo: (params: CreateRepoParams) => Promise<Repository | null>;
  createRepoInOrg: (params: CreateRepoParams) => Promise<Repository | null>;
  getAuthenticatedUser(): Promise<AuthenticatedUser | undefined>;
  getBranch: (params: GetBranch) => Promise<any>;
  getDetailsForUser(params: UserDetailParams): Promise<any>;
  getLatestCommit: (params: GetLatestCommitParams) => Promise<LatestCommit | null>;
  getDocument: (params: RepoContentParams) => Promise<DocumentDetails | null>;
  getOrganization?: (params: GetOrganization) => Promise<Organization | null>;
  getOrganizationsForAuthenticatedUser(params: PaginatorParams): Promise<{
    collection: Organization[];
    nextPage: string | null;
  } | null>;
  getRepo: (params: RepoParams) => Promise<Repository>;
  getRepoBranches(params: RepoBranchesParams): Promise<any>;
  getRepoContent(params: RepoContentParams): Promise<any>;
  getRepoContentRecursively: (params: RepoContentParams) => Promise<any[] | null>;
  getReposForAuthenticatedUser(params: ReposParams): Promise<{
    collection: Repository[];
    nextPage: string | null;
  } | null>;
  getReposForOrganization(params: ReposForOrgsParams): Promise<{
    collection: Repository[];
    nextPage: string | null;
  } | null>;
  getReposForUser(params: ReposForUserParams): Promise<{
    collection: Repository[];
    nextPage: string | null;
  } | null>;
  saveDocument: (params: SaveDocument) => Promise<null | ProviderError | Record<string, any>>;
  searchBlobs: (params: SearchBlobsParams) => Promise<any[]>;
  searchUsers: (query: string) => Promise<PublicRepository[]>;
}
