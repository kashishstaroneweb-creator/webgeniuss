import { FullStackBlueprint, GeneratedProjectFile } from '../entities/website.entity';

export interface ClaudeFullStackPlan {
  blueprint: FullStackBlueprint;
  backendFiles: GeneratedProjectFile[];
}

export interface MergedFullStackProject {
  blueprint: FullStackBlueprint;
  backendFiles: GeneratedProjectFile[];
  frontendPrompt: string;
}
