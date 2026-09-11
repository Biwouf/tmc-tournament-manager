import { useState, type ImgHTMLAttributes } from 'react';
import { useSite } from '../contexts/SiteContext';
import { responsiveImage } from '../lib/configImage';

/** Sources originales conservées ; optimisation Vercel des photos Storage du club seulement. */
export default function ConfigImage({ src, sizes, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const site = useSite();
  const [failed, setFailed] = useState(false);
  const responsive = !failed && src && site.optimizeImages
    ? responsiveImage(src, site.club.id, typeof props.width === 'number' ? props.width : undefined)
    : {};
  return <img {...props} src={src} {...responsive}
    sizes={responsive.srcSet ? sizes || '(max-width: 767px) 100vw, 50vw' : undefined}
    onError={responsive.srcSet ? () => setFailed(true) : undefined} />;
}
