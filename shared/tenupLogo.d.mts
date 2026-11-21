export type LogoVariantName = 'clean-1024' | 'avatar-256' | 'maskable-512' | 'maskable-192' | 'any-512' | 'apple-180' | 'email-128';
export type LogoVerdict = 'cleaned' | 'unchanged' | 'monogram';
export interface LogoChanges {
  background: 'black' | 'white' | 'color' | null;
  trimmed: boolean;
  upscaled: boolean;
}
export interface LogoSource { width: number; height: number; format: 'png' | 'jpeg' | 'webp' }
export interface LogoResult {
  verdict: LogoVerdict;
  palette: string[];
  source?: LogoSource;
  changes?: LogoChanges;
  variants?: Record<LogoVariantName, string>;
}
export const LOGO_VARIANTS: LogoVariantName[];
export const LOGO_VERDICTS: LogoVerdict[];
export function validateLogoResult(raw: unknown): LogoResult | null;
export function logoChangesText(changes: LogoChanges | null | undefined): string;
export function readLogoVariants(raw: unknown): Record<LogoVariantName, string> | null;
