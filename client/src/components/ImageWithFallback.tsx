import { ImageOff } from 'lucide-react';
import { useState, type ImgHTMLAttributes } from 'react';
import { cn } from '../utils/format';

/** Lazy image that degrades to a calm placeholder (not a broken icon) when a photo URL fails on a flaky network. */
export function ImageWithFallback({ className, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn('flex items-center justify-center bg-gradient-to-br from-forest-100 to-parchment-alt text-forest-200', className)}
      >
        <ImageOff className="size-8" aria-hidden />
      </div>
    );
  }
  return <img loading="lazy" decoding="async" alt={alt} onError={() => setFailed(true)} className={className} {...rest} />;
}
