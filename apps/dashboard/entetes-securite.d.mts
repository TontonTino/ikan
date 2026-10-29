export function origine(url: string): string | null;
export function politiqueCsp(apiUrl?: string, agentUrl?: string): string;
export function enTetesSecurite(options?: { production?: boolean; apiUrl?: string; agentUrl?: string }): Record<string, string>;
export function estProduction(env: Record<string, string | undefined>): boolean;
