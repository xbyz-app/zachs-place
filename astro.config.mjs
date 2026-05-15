import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://lab.xbyz.fun',
  build: {
    assets: 'assets'
  }
});
