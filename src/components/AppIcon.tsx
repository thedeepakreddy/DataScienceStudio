/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * The product mark: the "D" with its bars, on no tile (transparent), so it sits
 * directly on the page. A dark "D" for light backgrounds and a silver one for
 * dark backgrounds (/public/logo-mark*.png); `tone="auto"` follows the theme.
 * The favicon and home-screen icons keep the full tile.
 */
export default function AppIcon({ size = 28, className = '', tone = 'auto' }: { size?: number; className?: string; tone?: 'auto' | 'onLight' | 'onDark' }) {
  const img = (src: string, cls: string) => (
    <img src={src} width={size} height={size} alt="Data Science Studio" draggable={false}
      className={`shrink-0 select-none object-contain ${cls} ${className}`} style={{ width: size, height: size }} />
  );
  if (tone === 'onDark') return img('/logo-mark-light.png', '');
  if (tone === 'onLight') return img('/logo-mark.png', '');
  return (
    <>
      {img('/logo-mark.png', 'dark:hidden')}
      {img('/logo-mark-light.png', 'hidden dark:block')}
    </>
  );
}
