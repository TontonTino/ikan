export const VARIABLES_BUILD: string[];
export const VARIABLES_SERVEUR: string[];
export function variablesManquantes(env: Record<string, string | undefined>, noms: string[]): string[];
export function messageVariablesManquantes(manquantes: string[], etape: string): string;
