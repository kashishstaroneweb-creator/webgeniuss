import { FullStackBlueprint, GeneratedProjectFile, Website } from '../entities/website.entity';

export interface FullStackPlan {
  blueprint: FullStackBlueprint;
  backendFiles: GeneratedProjectFile[];
  runtimeId?: string;
  backendStatus?: Website['backendStatus'];
  backendLogs?: string;
  backendPreviewUrl?: string;
}

export interface MergedFullStackProject {
  blueprint: FullStackBlueprint;
  backendFiles: GeneratedProjectFile[];
  frontendPrompt: string;
}
