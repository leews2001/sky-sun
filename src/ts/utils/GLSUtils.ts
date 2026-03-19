import * as THREE from 'three';

/**
 * Replace #include <file.glsl> with actual file content.
 * @param source - GLSL shader source code
 * @param includeMap - Map of filenames to file content
 */
 


export function injectIncludes(
  source: string,
  includeMap: Record<string, string>,
  stack: string[] = []
): string {

  const includePattern = /^(\s*)#include\s+"([^"]+)"\s*$/gm;

  return source.replace(includePattern, (_, indent, includePath) => 
    {

      if (stack.includes(includePath)) {
        throw new Error(
          `Circular include detected:\n${[...stack, includePath].join(" -> ")}`
        );
      }

      const included = includeMap[includePath];

      if (!included) {
        throw new Error(`Missing GLSL include: ${includePath}`);
      }

      const injected = injectIncludes(
        included,
        includeMap,
        [...stack, includePath]
      );

      // preserve indentation
      const indented = injected
        .split("\n")
        .map(line => indent + line)
        .join("\n");

      return `${indented}`;
    }
  );
}

// export function injectIncludes(source: string, includeMap: Record<string, string>): string {
//   const includePattern = /^\s*#include\s+"(.+)"\s*$/gm;

//   return source.replace(includePattern, (match, includePath) => {
//     const included = includeMap[includePath];
//     if (!included) {
//       console.warn(`[injectIncludes] Missing include: ${includePath}`);
//       return `// [injectIncludes] Failed to include: ${includePath}`;
//     }
//     return injectIncludes(included, includeMap); // recursive includes supported
//   });
// }

export async function loadShader(path: string): Promise<string> 
{
  const url = new URL(path, window.location.href).href;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`Shader HTTP error`, {
        requestedPath: path,
        resolvedURL: url,
        status: res.status
      });
      throw new Error(`Failed to load shader: ${url}`);
    }

    const text = await res.text();

    if (text.trim().startsWith('<!doctype') || text.trim().startsWith('<html')) {
      console.error(`Shader returned HTML instead of GLSL`, {
        requestedPath: path,
        resolvedURL: url
      });
      throw new Error(`Shader path invalid: ${url}`);
    }

    return text;

  } catch (err) {
    console.error(`Shader load failed`, {
      requestedPath: path,
      resolvedURL: url,
      pageURL: window.location.href
    });
    throw err;
  }
}

export function createShaderMaterial( 
  materialName: string,
	width: number, height: number, 
	fragmentSource: string, 
	extraUniforms = {},
  sharedUniforms = {} // New parameter for global state
) : THREE.ShaderMaterial {

  const baseUniforms = {
      iResolution: { value: new THREE.Vector3( width, height, 1) },
      iTime: { value: 0. },
      iFrame: { value: 0 },
      iChannel0: { value: null },
      iChannel1: { value: null },
      iChannel2: { value: null },
      iChannelResolution: { value: [
          new THREE.Vector3(width, height, 1),
          new THREE.Vector3(width, height, 1),
          new THREE.Vector3(width, height, 1)
      ]}
  };
  const mergedUniforms = {
      ...baseUniforms,
      ...extraUniforms,
      ...sharedUniforms // Include shared uniforms for global state
  };

  return new THREE.ShaderMaterial({
      name: materialName,
      fragmentShader: fragmentSource,
      vertexShader: /* glsl */`
          void main() {
              gl_Position = vec4(position, 1.0);
          }
      `,
      uniforms: mergedUniforms
  });
  } // createShaderMaterial

export function createRenderTarget(wd: number, ht: number): THREE.WebGLRenderTarget {
        return new THREE.WebGLRenderTarget(wd, ht, {
            type: THREE.FloatType,
            format: THREE.RGBAFormat,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter,
            depthBuffer: false,
            stencilBuffer: false
        });
    } // createRenderTarget

