import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  plugins: [
    glsl({
      // Process common shader file types
      include: ['**/*.glsl', '**/*.frag', '**/*.vert'],
      // Enable #include expansion
      defaultExtension: 'glsl',
    }),
  ],
  server: {
    open: true, // auto opens browser
  },
  assetsInclude: ['**/*.png', '**/*.jpg'], // support texture loading
});

