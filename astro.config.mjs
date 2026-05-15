import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://guest.xbyz.fun',
  build: {
    assets: 'assets'
  }
});
