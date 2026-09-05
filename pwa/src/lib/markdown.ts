import type { Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// Même contrat dans le BO et la PWA. Conserver le soulignement de l'éditeur,
// jamais les styles, formulaires ou contenus exécutables fournis par un auteur.
export const editorialRehypePlugins: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
    strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'form', 'input',
      'button', 'object', 'embed', 'link', 'meta'],
  }],
];
