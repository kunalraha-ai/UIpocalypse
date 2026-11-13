/** Analyzer data model: app map (FR-A3) + issues (FR-A4). */

export type Framework = 'next-app' | 'next-pages' | 'vite-react' | 'unknown';

export type RouteInfo = { path: string; kind: 'page' | 'api'; file: string };

export type ElementInfo = {
  tag: string;
  file: string;
  line: number;
  label: string; // element text or accessible-ish name
  handlers: string[]; // e.g. ['onClick']
  emptyHandlers: string[]; // handler props whose function body is empty
  inForm: boolean;
  ariaHidden: boolean;
  hasAction: boolean; // form: action attr
  hasOnSubmit: boolean; // form: onSubmit handler
  hasMethodAttr: boolean; // form: method attr (native dialog forms use method="dialog")
  submitType: boolean; // button: type="submit" or default-in-form
};

export type ApiCallInfo = {
  file: string;
  line: number;
  url: string; // static prefix of the request path ('' if fully dynamic)
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OTHER';
  enclosingFnHasErrorHandling: boolean;
};

export type EnvVarInfo = { name: string; file: string; line: number };

export type AppMap = {
  framework: Framework;
  stack: string[];
  files: string[];
  routes: RouteInfo[];
  elements: ElementInfo[];
  apiCalls: ApiCallInfo[];
  envVars: EnvVarInfo[];
  /** resolved relative import edges: file -> imported files (project-internal only) */
  imports: Record<string, string[]>;
  /** files starting with the 'use client' directive */
  clientEntryFiles: string[];
  supabase: { tables: string[]; clientFiles: string[]; migrations: string[] };
  fileCount: number;
  extractedAt: string;
};

export type Severity = 'low' | 'medium' | 'high' | 'info';

export type Issue = {
  rule: string;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  fixHint?: string;
};

export type ScanOutput = {
  appMap: AppMap;
  issues: Issue[];
};
