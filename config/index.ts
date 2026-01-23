/* -------------------------------------------------
   Core Config Types
------------------------------------------------- */

export type HostProvider =
  | 'vercel'
  | 'netlify'
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'heroku'
  | 'apache'
  | 'custom'
  | 'none';

/* -------------------------------------------------
   App Metadata
------------------------------------------------- */

export type AppVersion = {
  code: number;
  name: string;
};

export type AppConfig = {
  name: string;
  id: string;
  version: AppVersion;
  description?: string;
};

/* -------------------------------------------------
   Platform Configs
------------------------------------------------- */

export type AndroidConfig = {
  minSdk?: number;
  targetSdk?: number;
  permissions?: string[];
  icon?: string;
  splash?: string;
  deepLinks: string[]

  signing?: {
    keystore: string;
    storePassword: string;
    keyAlias: string;
    keyPassword: string;
  };
};
export type WindowsConfig = {
  publisher: string;
  icon: string;
  executionAlias: string; 
  sdkVersion: string
  minSdkVersion: string, 
};
export type WebConfig = {
  title?: string;
  themeColor?: string;
  basePath?: string;
};

export type PlatformsConfig = {
  android?: AndroidConfig;
  web?: WebConfig;

  // future
  ios?: Record<string, any>;
  windows?: WindowsConfig;
  macos?: Record<string, any>;
};

/* -------------------------------------------------
   Main VaderJS Config
------------------------------------------------- */

export type Config = {
  /** Dev server */
  port: number;
  host?: string;

  /** Plugin system */
  plugins?: any[];
  generateTypes?: boolean;

  /** Hosting */
  host_provider?: HostProvider;
  host_provider_options?: Record<string, any>;

  /** App metadata */
  app?: AppConfig;

  /** Platform-specific configuration */
  platforms?: PlatformsConfig;
};

/* -------------------------------------------------
   defineConfig helper
------------------------------------------------- */

export default function defineConfig(config: Config): Config {
  return config;
}
