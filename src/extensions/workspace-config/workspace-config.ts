import * as path from 'path';
import * as fs from 'fs-extra';
import { pick, omit } from 'ramda';
import { parse, stringify, assign } from 'comment-json';
import LegacyWorkspaceConfig from '../../consumer/config/workspace-config';
import ConsumerOverrides from '../../consumer/config/consumer-overrides';
import { BIT_JSONC, DEFAULT_LANGUAGE, COMPILER_ENV_TYPE } from '../../constants';
import { PathOsBased, PathOsBasedAbsolute } from '../../utils/path';
import InvalidConfigFile from './exceptions/invalid-config-file';
import DataToPersist from '../../consumer/component/sources/data-to-persist';
import { AbstractVinyl } from '../../consumer/component/sources';
import { ResolveModulesConfig } from '../../consumer/component/dependencies/dependency-resolver/types/dependency-tree-type';
import { Compilers, Testers } from '../../consumer/config/abstract-config';

// TODO: get the types in a better way
import { PMConfig } from '../package-manager';
import { EnvType } from '../../legacy-extensions/env-extension-types';

interface WorkspaceConfigProps {
  componentsDefaultDirectory?: string;
  dependenciesDirectory?: string;
  defaultScope?: string;
  saveDependenciesAsComponents?: boolean;
  resolveModules?: ResolveModulesConfig;
  packageManager: PMConfig;
  _useWorkspaces?: boolean;
  _manageWorkspaces?: boolean;
  _bindingPrefix?: string;
  _dependenciesDirectory?: string | undefined;
  _resolveModules?: ResolveModulesConfig | undefined;
  _saveDependenciesAsComponents?: boolean;
  _distEntry?: string | undefined;
  _distTarget?: string | undefined;
}

export type WorkspaceConfigFileInputProps = {
  workspace: WorkspaceConfigProps;
  components: ConsumerOverrides;
};
export type WorkspaceConfigFileProps = {
  $schema: string;
  $schemaVersion: string;
} & WorkspaceConfigFileInputProps;

export default class WorkspaceConfig {
  _path?: string;

  constructor(private data?: WorkspaceConfigFileProps, private legacyConfig?: LegacyWorkspaceConfig) {}

  get path(): PathOsBased {
    return this._path || this.legacyConfig?.path || '';
  }

  set path(configPath: PathOsBased) {
    this._path = configPath;
  }

  get lang(): string {
    return this.legacyConfig?.lang || DEFAULT_LANGUAGE;
  }

  get _compiler(): Compilers | undefined {
    return this.legacyConfig?.compiler;
  }

  get _tester(): Testers | undefined {
    return this.legacyConfig?.tester;
  }

  _getEnvsByType(type: EnvType): Compilers | Testers | undefined {
    if (type === COMPILER_ENV_TYPE) {
      return this.legacyConfig?.compiler;
    }
    return this.legacyConfig?.tester;
  }

  // TODO: define type somehow
  /**
   * Return only the configs that are workspace related (without components configs or schema definition)
   *
   * @readonly
   * @memberof WorkspaceConfig
   */
  get workspaceConfig() {
    if (this.data) {
      return this.data.workspace;
    }
    // legacy configs
    return {
      defaultScope: this.legacyConfig?.defaultScope,
      componentsDefaultDirectory: this.legacyConfig?.componentsDefaultDirectory,
      dependenciesDirectory: this.legacyConfig?.dependenciesDirectory,
      packageManager: {
        packageManager: this.legacyConfig?.packageManager,
        packageManagerArgs: this.legacyConfig?.packageManagerArgs,
        packageManagerProcessOptions: this.legacyConfig?.packageManagerProcessOptions
      },
      _bindingPrefix: this.legacyConfig?.bindingPrefix,
      _useWorkspaces: this.legacyConfig?.useWorkspaces,
      _manageWorkspaces: this.legacyConfig?.manageWorkspaces,
      _dependenciesDirectory: this.legacyConfig?.dependenciesDirectory,
      _resolveModules: this.legacyConfig?.resolveModules,
      _saveDependenciesAsComponents: this.legacyConfig?.saveDependenciesAsComponents,
      _distEntry: this.legacyConfig?.distEntry,
      _distTarget: this.legacyConfig?.distTarget
    };
  }

  /**
   * Return the components section of the config file
   *
   * @readonly
   * @memberof WorkspaceConfig
   */
  get componentsConfig(): ConsumerOverrides | undefined {
    if (this.data) {
      return ConsumerOverrides.load(this.data.components);
    }
    // legacy configs
    return this.legacyConfig?.overrides;
  }

  /**
   * Create an instance of the WorkspaceConfig by an instance of the legacy config
   *
   * @static
   * @param {*} legacyConfig
   * @returns
   * @memberof WorkspaceConfig
   */
  static fromLegacyConfig(legacyConfig) {
    return new WorkspaceConfig(undefined, legacyConfig);
  }

  /**
   * Create an instance of the WorkspaceConfig by data
   *
   * @static
   * @param {WorkspaceConfigFileProps} data
   * @returns
   * @memberof WorkspaceConfig
   */
  static fromObject(data: WorkspaceConfigFileProps) {
    return new WorkspaceConfig(data, undefined);
  }

  /**
   * Create an instance of the WorkspaceConfig by the workspace config template and override values
   *
   * @static
   * @param {WorkspaceConfigFileProps} data values to override in the default template
   * @returns
   * @memberof WorkspaceConfig
   */
  static create(props: WorkspaceConfigFileProps, dirPath?: PathOsBasedAbsolute) {
    const templateStr = fs.readFileSync(path.join(__dirname, './workspace-template.jsonc')).toString();
    const template = parse(templateStr);
    const merged = assign(template, props);
    const instance = new WorkspaceConfig(merged, undefined);
    if (dirPath) {
      instance.path = this.composeBitJsoncPath(dirPath);
    }
    return instance;
  }

  /**
   * Ensure the given directory has a workspace config
   * Load if existing and create new if not
   *
   * @static
   * @param {PathOsBasedAbsolute} dirPath
   * @param {WorkspaceConfigFileProps} [workspaceConfigProps={} as any]
   * @returns {Promise<WorkspaceConfig>}
   * @memberof WorkspaceConfig
   */
  static async ensure(
    dirPath: PathOsBasedAbsolute,
    workspaceConfigProps: WorkspaceConfigFileProps = {} as any
  ): Promise<WorkspaceConfig> {
    let workspaceConfig = await this.loadIfExist(dirPath);
    if (workspaceConfig) {
      return workspaceConfig;
    }
    workspaceConfig = this.create(workspaceConfigProps, dirPath);
    return workspaceConfig;
  }

  /**
   * Get the path of the bit.jsonc file by a containing folder
   *
   * @static
   * @param {PathOsBased} dirPath containing dir of the bit.jsonc file
   * @returns {PathOsBased}
   * @memberof WorkspaceConfig
   */
  static composeBitJsoncPath(dirPath: PathOsBased): PathOsBased {
    return path.join(dirPath, BIT_JSONC);
  }

  static async pathHasBitJsonc(dirPath: PathOsBased): Promise<boolean> {
    return fs.pathExists(this.composeBitJsoncPath(dirPath));
  }

  /**
   * Load the workspace configuration if it's exist
   *
   * @static
   * @param {PathOsBased} dirPath
   * @returns {(Promise<WorkspaceConfig | undefined>)}
   * @memberof WorkspaceConfig
   */
  static async loadIfExist(dirPath: PathOsBased): Promise<WorkspaceConfig | undefined> {
    const jsoncExist = await this.pathHasBitJsonc(dirPath);
    if (jsoncExist) {
      const jsoncPath = this.composeBitJsoncPath(dirPath);
      const instance = await this._loadFromBitJsonc(jsoncPath);
      instance.path = jsoncPath;
      return instance;
    }
    const legacyConfig = await LegacyWorkspaceConfig.loadIfExist(dirPath);
    if (legacyConfig) {
      return this.fromLegacyConfig(legacyConfig);
    }
    return undefined;
  }

  static async _loadFromBitJsonc(bitJsoncPath: PathOsBased): Promise<WorkspaceConfig> {
    const contentBuffer = await fs.readFile(bitJsoncPath);
    try {
      const parsed = parse(contentBuffer.toString());
      return this.fromObject(parsed);
    } catch (e) {
      throw new InvalidConfigFile(bitJsoncPath);
    }
  }

  async write({ workspaceDir }: { workspaceDir: PathOsBasedAbsolute }): Promise<void> {
    if (this.data) {
      const file = await this.toVinyl(workspaceDir);
      const dataToPersist = new DataToPersist();
      if (file) {
        dataToPersist.addFile(file);
        return dataToPersist.persistAllToFS();
      }
    }
    this.legacyConfig?.write({ workspaceDir });
    return undefined;
  }

  async toVinyl(workspaceDir: PathOsBasedAbsolute): Promise<AbstractVinyl | undefined> {
    if (this.data) {
      const jsonStr = stringify(this.data, undefined, 2);
      const base = workspaceDir;
      const fullPath = workspaceDir ? WorkspaceConfig.composeBitJsoncPath(workspaceDir) : this.path;
      const jsonFile = new AbstractVinyl({ base, path: fullPath, contents: Buffer.from(jsonStr) });
      return jsonFile;
    }
    return this.legacyConfig?.toVinyl({ workspaceDir });
  }

  toPlainObject(): { [prop: string]: any } | undefined {
    if (this.legacyConfig) {
      return this.legacyConfig.toPlainObject();
    }
    return undefined;
  }

  /**
   * Returns object with configs per extensions
   *
   * @memberof WorkspaceConfig
   */
  getCoreExtensionsConfig(): { [extensionName: string]: any } {
    const workspaceConfig = this.workspaceConfig;
    // TODO: take it somehow from harmony that should get it by the workspace extension manifest
    const workspaceExtPropNames = ['defaultScope', 'componentsDefaultDirectory'];
    const workspaceExtProps = pick(workspaceExtPropNames, workspaceConfig);
    const result = omit(workspaceExtPropNames, workspaceConfig);
    result.workspace = workspaceExtProps;
    return result;
  }
}