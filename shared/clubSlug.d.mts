export const RESERVED_SLUGS: readonly string[];
export function isReservedSlug(slug: string): boolean;
export const SIGNUP_SLUG_PATTERN: RegExp;
export function signupSlugProblem(slug: unknown): 'format' | 'reserved' | null;
