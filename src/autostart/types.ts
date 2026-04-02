export type AutostartMode = "systemd" | "windows-task";
export type PersistedAutostartMode = AutostartMode | "manual";

export interface LaunchCommand {
  executable: string;
  args: string[];
  display: string;
}

export interface AutostartActionResult {
  mode: AutostartMode;
  artifactPath: string;
  summary: string;
  details: string[];
  dryRun: boolean;
}

export interface AutostartStatus {
  supported: boolean;
  enabled: boolean;
  mode: AutostartMode | null;
  artifactPath?: string;
  summary: string;
  details: string[];
}
