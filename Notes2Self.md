

## Code Structure

Sharing GLSL code that multiple shaders include is recommended. Game engines and rendering frameworks do this all the time. It does not cause runtime GPU performance issues if done correctly.
But there are a few details that matter.

⸻

1. Includes are resolved before compilation

Your #include system runs in JavaScript/TypeScript, producing a single final GLSL string.

Example:
```c
#include "lighting.glsl"
#include "math.glsl"
```
Becomes:
```c
float saturate(float x) { ... }
vec3 computeLighting(...) { ... }
void main() { ... }
```
After this, the GPU sees one normal shader. No runtime cost. No dynamic linking. No overhead.

⸻

2. The GPU compiler optimizes unused functions away

Modern GLSL compilers will remove unused code.

Example:
```c
float unused() { return 1.0; }
```
If it’s never called, it disappears during optimization.

So a shared library file like:
```
common.glsl
math.glsl
lighting.glsl
noise.glsl
```
won’t hurt performance unless the code is actually used.

⸻

3. The real downside: shader compile time

Huge includes can increase shader compile time slightly.

Example structure:
```
common.glsl (2000 lines)
lighting.glsl (1500 lines)
pbr.glsl (2000 lines)
noise.glsl (1000 lines)
```
If every shader includes everything:
``
final shader = 6500 lines
``
Compilation might take longer.

But in WebGL/WebGPU this usually only happens:
	•	once at startup
	•	or when hot-reloading

So it’s rarely a problem.

⸻

4. Best practice structure

Instead of one massive common.glsl, split it:
```
glsl/
  math.glsl
  lighting.glsl
  noise.glsl
  pbr.glsl
  tonemap.glsl
```
Then shaders include only what they need:
```c
#include "math.glsl"
#include "lighting.glsl"
```

⸻

5. Very large engines use this approach

Major engines do exactly this:
	•	Three.js
	•	Babylon.js
	•	Unity
	•	Unreal
	•	Godot

They all have shader chunks.

Example pattern:
```c
#include <common>
#include <packing>
#include <lights_pars>
```

⸻

6. A good rule

A shared library is great for:
	•	math utilities
	•	noise
	•	lighting functions
	•	PBR helpers
	•	tone mapping
	•	color space conversions
	•	BRDF functions

Avoid putting entire pipelines into common files.

⸻

7. A powerful trick: feature flags

Instead of always compiling everything:
```c
#ifdef USE_PBR
#include "pbr.glsl"
#endif
```
Then enable it in JS:
```typescript
shaderSource = "#define USE_PBR\n" + shaderSource;
```
This keeps shaders minimal.

---
# Shader system  pattern used in modern engines

Modern engines don’t treat shaders as flat text files. They treat them like modules with dependencies, similar to how JS/TS imports work. The system usually has three parts:

1.	Shader modules
2.	Dependency graph
3.	Automatic resolution + compilation pipeline

This makes large shader libraries maintainable and prevents huge monolithic shaders.

## 1. Shader Modules

Each GLSL file is treated as a module exporting functions, constants, or structs.

Example structure:
```
shaders/
  core/
    math.glsl
    color.glsl
  lighting/
    brdf.glsl
    pbr.glsl
  camera/
    camera_ray.glsl
  noise/
    simplex.glsl
```
Example module:

math.glsl
```c
#ifndef MATH_GLSL
#define MATH_GLSL

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

#endif
```
### 2. Shader Dependency Declaration

Instead of raw includes everywhere, shaders declare dependencies.

Example:
```c
#pragma include "core/math.glsl"
#pragma include "lighting/brdf.glsl"
```
Or engines use special syntax:
```c
#include <core/math>
#include <lighting/brdf>
```
This allows the engine to build a dependency graph.

### 3. Dependency Graph

At build time the engine creates a graph:
```
fragment.glsl
   │
   ├── lighting/brdf.glsl
   │        │
   │        └── core/math.glsl
   │
   └── noise/simplex.glsl
            │
            └── core/math.glsl
```
Notice: math.glsl appears twice

The graph ensures it is included only once.

### 4. Topological Ordering

Before compiling, the engine resolves the correct order:
```
math.glsl
simplex.glsl
brdf.glsl
fragment.glsl
```
This prevents forward-reference issues.

### 5. Automatic Shader Builder

Typical shader build pipeline:
```
raw shader
   ↓
parse includes
   ↓
build dependency graph
   ↓
remove duplicates
   ↓
topological sort
   ↓
inject modules
   ↓
final shader source
```

### Example Final Output

Input shader:
```c
#version 300 es

#pragma include "camera/camera_ray.glsl"
#pragma include "lighting/pbr.glsl"

void main() {
    vec3 ray = cameraRay(gl_FragCoord.xy);
}
```
Final compiled shader:
```c
#version 300 es

// module: core/math.glsl
float saturate(float x){ return clamp(x,0.0,1.0); }

// module: camera/camera_ray.glsl
vec3 cameraRay(vec2 fragCoord){ ... }

// module: lighting/pbr.glsl
vec3 computePBR(...){ ... }

void main(){
    vec3 ray = cameraRay(gl_FragCoord.xy);
}
```

### 6. Real Engines Use “Shader Chunks”

Engines store reusable pieces.

Example system:
```c
shaderChunks = {
  "math": "...",
  "lighting": "...",
  "noise": "...",
}
```
Shader:
```c
#include <math>
#include <lighting>
```
Resolved dynamically.

### 7. Feature Flags (Very Important)

Instead of many shader variants:
```c
#define USE_NORMAL_MAP
#define USE_PBR
```
Modules can activate features:
```c
#ifdef USE_PBR
vec3 computePBR(...) { ... }
#endif
```
The engine composes shaders based on material features.

### 8. Example Minimal Implementation (TypeScript)

Dependency resolver concept:
```c
function buildShader(entry: string, modules: Record<string,string>) {
  const visited = new Set<string>();
  const output: string[] = [];

  function resolve(name: string) {
    if (visited.has(name)) return;
    visited.add(name);

    const src = modules[name];

    const deps = [...src.matchAll(/#include\s+"(.+?)"/g)]
      .map(m => m[1]);

    for (const d of deps) resolve(d);

    output.push(src.replace(/#include\s+"(.+?)"/g, ""));
  }

  resolve(entry);

  return output.join("\n");
}
```
This produces a correct dependency order.

### 9. Advanced Systems Add

Real engines add more layers:

Shader variant generation
```
PBR + Shadows + Skinning
PBR + Shadows
PBR
```
Automatic uniform injection
```
uViewMatrix
uProjectionMatrix
uTime
```
Material graph compilation
```
Node graphs → GLSL.
```
Precompiled shader cache

Avoid recompiling identical shaders.

### 10. Typical Modern Shader Architecture
```
ShaderSource
      │
      ▼
Module Resolver
      │
      ▼
Dependency Graph
      │
      ▼
Feature Flags
      │
      ▼
Shader Variant Builder
      │
      ▼
Final GLSL
      │
      ▼
GPU Compilation
```

### 11. Why This Pattern Matters

Without this system large projects suffer from:

•	duplicated shader code
•	fragile includes
•	impossible maintenance
•	compile explosion

With it you get:

•	reusable shader libraries
•	modular lighting systems
•	controllable shader variants
•	faster development

Almost every serious renderer (Unity, Unreal, Frostbite, Filament, Three.js internally) uses some version of this modular shader graph system.

---

# “mini shader engine” architecture 
Below is a compact “mini shader engine” architecture (~120–150 lines conceptually) that implements the same core ideas used in modern engines:

•	shader modules
•	dependency graph
•	feature flags
•	shader variants
•	caching
•	automatic include resolution

This pattern scales very well when your shader library grows.

### 1. Shader Module Registry

Every shader piece is registered as a module.
```c
type ShaderModule = {
  name: string
  source: string
}

const shaderModules: Record<string, ShaderModule> = {};
```

Register modules:

```c
export function registerModule(name: string, source: string) {
  shaderModules[name] = { name, source };
}
```

Example modules:
```c
registerModule("math", `
float saturate(float x){
  return clamp(x,0.0,1.0);
}
`);

registerModule("camera_ray", `
vec3 cameraRay(vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  return normalize(vec3(uv,1.0));
}
`);
```

### 2. Dependency Detection

Modules can declare dependencies:
```c
#include <math>

Parser:

const includeRegex = /#include\s+<([\w\/\-]+)>/g;

function getDependencies(src: string): string[] {
  return [...src.matchAll(includeRegex)].map(m => m[1]);
}
```
 

### 3. Dependency Graph Resolver

This ensures correct include order and removes duplicates.
```c
function resolveGraph(entrySource: string) {
  const visited = new Set<string>();
  const ordered: string[] = [];

  function visit(moduleName: string) {
    if (visited.has(moduleName)) return;

    const mod = shaderModules[moduleName];
    if (!mod) throw new Error(`Missing shader module: ${moduleName}`);

    visited.add(moduleName);

    const deps = getDependencies(mod.source);

    for (const d of deps) visit(d);

    ordered.push(moduleName);
  }

  const entryDeps = getDependencies(entrySource);
  for (const d of entryDeps) visit(d);

  return ordered;
}
```


### 4. Shader Builder

Builds the final GLSL source.
```c
function buildShader(entrySource: string) {

  const order = resolveGraph(entrySource);

  let output = "";

  for (const name of order) {

    const src = shaderModules[name].source
      .replace(includeRegex, "");

    output += `\n// module: ${name}\n`;
    output += src;
  }

  output += "\n// entry\n";
  output += entrySource.replace(includeRegex, "");

  return output;
}
```


### 5. Feature Flags

Materials enable features like:
```
PBR
SHADOWS
NORMAL_MAP
```
Add them automatically:
```c
function injectDefines(source: string, flags: string[]) {

  const defines = flags
    .map(f => `#define ${f}`)
    .join("\n");

  return defines + "\n" + source;
}
```
Example:
```c
const flags = ["USE_PBR", "USE_FOG"];
```
Shader code:
```c
#ifdef USE_PBR
vec3 computePBR(...) { ... }
#endif
```
 

### 6. Shader Variant Cache

Avoid recompiling identical shaders.
```c
const shaderCache = new Map<string,string>();

function buildShaderVariant(source: string, flags: string[]) {

  const key = source + flags.join("|");

  if (shaderCache.has(key))
    return shaderCache.get(key)!;

  const withDefines = injectDefines(source, flags);
  const finalSource = buildShader(withDefines);

  shaderCache.set(key, finalSource);

  return finalSource;
}
```

### 7. Example Shader

Entry shader:
```c
#version 300 es

#include <camera_ray>
#include <math>

out vec4 fragColor;

void main(){

  vec3 ray = cameraRay(gl_FragCoord.xy);

  fragColor = vec4(ray,1.0);
}
```
Compile:
```c
const shader = buildShaderVariant(fragmentShaderSource, [
  "USE_PBR"
]);
```

### 8. Resulting Shader

Generated automatically:
```c
#define USE_PBR

#version 300 es

// module: math
float saturate(float x){
  return clamp(x,0.0,1.0);
}

// module: camera_ray
vec3 cameraRay(vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  return normalize(vec3(uv,1.0));
}

// entry
out vec4 fragColor;

void main(){
  vec3 ray = cameraRay(gl_FragCoord.xy);
  fragColor = vec4(ray,1.0);
}
```

### 9. Why This Pattern Works

Benefits:

#### No duplicated includes

Dependency graph ensures:
```c
math.glsl included once
```


#### Stable module ordering

No random include order bugs.

#### Automatic shader variants

Materials can toggle features.
```
PBR
PBR + Shadows
Unlit
```

#### Fast rebuilds

Cache avoids recomputing identical shaders.

### 10. How Real Engines Extend This

Large engines add:

#### Shader reflection

Extract uniforms automatically.


#### Automatic bindings
```
uViewMatrix
uProjectionMatrix
uTime
```

#### Node material graphs

Visual nodes → compiled GLSL.


#### Cross-platform backends

GLSL → SPIR-V → Metal/HLSL.


### 11. Typical Engine Shader Library
```
shader_modules/
  core/
    math.glsl
    color.glsl
  camera/
    camera_ray.glsl
  lighting/
    brdf.glsl
    pbr.glsl
  noise/
    simplex.glsl
  tonemap/
    aces.glsl
```

This grows safely to hundreds of modules.

One last trick used by serious renderers. They add a directive like:
```c
#pragma once
```
so modules are guaranteed single inclusion, even if dependency graph fails.



---
# Architecture: Uber-Shaders + Feature Bitmasks

The “1000 shader variants problem” happens when features multiply each other.

Example features:
```
PBR
NORMAL_MAP
SHADOWS
SKINNING
FOG
PARALLAX
EMISSIVE
```
If each feature is optional:
```c
2^7 = 128 shader variants
```
Real engines easily reach 30–50 features, which becomes millions of combinations.

Modern engines solve this using Uber-Shaders + feature bitmasks + lazy compilation.

### 1. Uber Shader Concept

Instead of writing many shaders, you write one big shader with feature switches.

Example:
```c
vec3 computeLighting(vec3 normal, vec3 viewDir)
{
#ifdef USE_PBR
    return computePBR(normal, viewDir);
#else
    return computeLambert(normal);
#endif
}
```
Another example:
``` c
#ifdef USE_NORMAL_MAP
    normal = applyNormalMap();
#endif
```
One shader supports many materials.

### 2. Feature Bitmask System

Each feature is assigned a bit.

Example:
```c
enum ShaderFeature {
  PBR        = 1 << 0,
  NORMALMAP  = 1 << 1,
  SHADOWS    = 1 << 2,
  SKINNING   = 1 << 3,
  FOG        = 1 << 4,
}
```
A material builds a bitmask:
```ts
let mask = 0;

mask |= ShaderFeature.PBR;
mask |= ShaderFeature.NORMALMAP;
mask |= ShaderFeature.SHADOWS;
```

Result:
```ts
mask = 0b00000111
```

This uniquely identifies a shader variant.

### 3. Shader Cache Using Bitmask
```ts
const shaderCache = new Map<number, WebGLProgram>();
```

Compile only when needed:
```ts
function getShader(mask: number): WebGLProgram {

  if (shaderCache.has(mask))
    return shaderCache.get(mask)!;

  const source = buildShaderFromMask(mask);
  const program = compileGLSL(source);

  shaderCache.set(mask, program);

  return program;
}
```
Result: Only shaders actually used get compiled. Huge performance improvement.

### 4. Mask → GLSL Defines

Convert bitmask to #defines.
```ts
function maskToDefines(mask: number) {

  const defs: string[] = [];

  if (mask & ShaderFeature.PBR)
    defs.push("#define USE_PBR");

  if (mask & ShaderFeature.NORMALMAP)
    defs.push("#define USE_NORMAL_MAP");

  if (mask & ShaderFeature.SHADOWS)
    defs.push("#define USE_SHADOWS");

  return defs.join("\n");
}
```
Then prepend to shader source.


### 5. Final Shader Compilation
```ts
function buildShaderFromMask(mask: number) {

  const defines = maskToDefines(mask);

  const source = `
${defines}

${uberShaderSource}
`;

  return buildShader(source);
}
```

### 6. Uber Shader Example

A real engine shader often looks like this:
```ts
vec3 computeSurfaceNormal()
{
#ifdef USE_NORMAL_MAP
    return applyNormalMap();
#else
    return vNormal;
#endif
}

vec3 computeLighting(vec3 normal)
{
#ifdef USE_PBR
    return pbrLighting(normal);
#else
    return lambertLighting(normal);
#endif
}

void main()
{
    vec3 normal = computeSurfaceNormal();

#ifdef USE_SHADOWS
    float shadow = computeShadow();
#else
    float shadow = 1.0;
#endif

    vec3 color = computeLighting(normal) * shadow;

#ifdef USE_FOG
    color = applyFog(color);
#endif

    fragColor = vec4(color,1.0);
}
```

This single shader can replace hundreds of separate shaders.


### 7. Why This Is Powerful

Instead of prebuilding:
```
128 shader variants
```
You compile only the ones actually used.

Example scene:
```
Material 1 → PBR + NORMALMAP
Material 2 → PBR
Material 3 → UNLIT
```
Only 3 shaders compile, not 128.

### 8. Real Engine Numbers

Large engines often support:
```
30–60 shader features
```
Theoretical combinations:
```
2^60 ≈ 1 quintillion
```
But actual compiled shaders in a scene:
```
10–50
```
Because of lazy compilation.

### 9. Further Optimizations Used in Engines

#### Feature grouping

Instead of:
```
NORMALMAP
PARALLAX
DETAILMAP
```
Use:
```
SURFACE_DETAIL_MODE
```
Reducing variants.


#### Static branching

GPU removes unused branches during compilation.
```ts
#ifdef USE_PBR
```

is zero runtime cost.

#### Shader warmup

Engines precompile common masks:
```
PBR
PBR + SHADOWS
PBR + NORMALMAP
```
to avoid runtime stutter.


#### 10. Full Modern Shader Pipeline

Typical engine pipeline:
```
Shader Modules
      │
      ▼
Dependency Graph
      │
      ▼
Uber Shader
      │
      ▼
Feature Bitmask
      │
      ▼
GLSL Defines
      │
      ▼
Variant Compilation
      │
      ▼
Shader Cache
```

#### 11. Combined With Module System

Your final shader system becomes:
```
modules/
  math
  noise
  pbr
  camera
  fog
```
```
uber shaders/
  surface.glsl
  postprocess.glsl
```
Modules handle code reuse, Uber shaders handle feature variants.


### 12. Result

You get a shader system that scales to:
```
100+ modules
50+ features
thousands of materials
```
without becoming unmaintainable.

---
# SDF Graphs + Shader (for Procedural Worlds)

For raymarching / SDF renderers, large projects quickly become messy if everything lives in one shader. Serious renderers solve this with an SDF module graph system.

Instead of writing one giant map() function, you build the scene from composable modules.

Think of it like a node graph that compiles to GLSL.

### 1. The Problem With Naive Raymarch Shaders

Typical small shader:
```c
float map(vec3 p)
{
    float s = sdSphere(p, 1.0);
    float b = sdBox(p - vec3(2,0,0), vec3(1));
    return min(s, b);
}
```
This works for small demos, but large scenes become:
```
1000+ lines
deep boolean trees
hard to reuse shapes
impossible to maintain
```

### 2. Scene Graph for SDF

Instead of one map(), you build a scene graph.

Example conceptual structure:
```
Scene
 ├── Sphere
 ├── Union
 │     ├── Box
 │     └── Torus
 └── SmoothUnion
       ├── Cylinder
       └── Sphere
```

Each node becomes generated GLSL.

### 3. SDF Node Interface

Each node defines:
```
distance
material
(optional) transform
```
TypeScript structure:
```ts
type SDFNode = {
  type: string
  children?: SDFNode[]
  params?: any
}
```
Example scene:
```ts
const scene = {
  type: "union",
  children: [
    { type: "sphere", params: { r: 1 } },
    { type: "box", params: { size: [1,1,1], pos:[2,0,0] } }
  ]
}
```

### 4. GLSL Module Library

Each SDF primitive lives in a module.
```
sdf/
  sphere.glsl
  box.glsl
  torus.glsl
  cylinder.glsl
ops/
  union.glsl
  smooth_union.glsl
  subtract.glsl
```
Example primitive:
```ts
float sdf_sphere(vec3 p, float r)
{
    return length(p) - r;
}
```
Example operation:
```ts
float op_union(float a, float b)
{
    return min(a,b);
}
```

### 5. Shader Code Generator

The engine converts the node graph → GLSL code.

Example generator:
```ts
function compileNode(node: SDFNode, id=0): string {

  if (node.type === "sphere")
    return `float d${id} = sdf_sphere(p, ${node.params.r});`;

  if (node.type === "box")
    return `float d${id} = sdf_box(p, vec3(${node.params.size.join(",")}));`;

  if (node.type === "union") {

    const a = compileNode(node.children![0], id+1);
    const b = compileNode(node.children![1], id+2);

    return `
${a}
${b}
float d${id} = op_union(d${id+1}, d${id+2});
`;
  }

  return "";
}
```

### 6. Generated map() Function

The graph becomes a flat GLSL function.

Example generated result:
```ts
float map(vec3 p)
{
float d1 = sdf_sphere(p,1.0);
float d2 = sdf_box(p-vec3(2,0,0),vec3(1.0));
float d0 = op_union(d1,d2);

return d0;
}
```
Now the scene is fully generated.


### 7. Transform Nodes

Nodes can apply transforms.

Scene graph:
```
Translate
   └── Sphere
```
Generated GLSL:
```ts
vec3 p1 = p - vec3(2,0,0);
float d1 = sdf_sphere(p1,1.0);
```
Transforms become local coordinate spaces.


### 8. Material Graph

Distance alone isn’t enough; we also track material ID.

Return struct:
```ts
struct Hit
{
    float dist;
    int material;
};
```
Union operation:
```ts
Hit op_union(Hit a, Hit b)
{
    return (a.dist < b.dist) ? a : b;
}
```
Now you get:
```
distance + material
```
for shading.


### 9. Real SDF Scene Graph

A real renderer graph might look like:
```
Scene
 ├── Terrain (noise SDF)
 ├── Buildings
 │      ├── Box
 │      ├── Box
 │      └── Box
 ├── Characters
 │      └── Skeleton SDF
 └── Boolean operations
```
Each part compiles independently.

### 10. GPU-Friendly Result

Even though the system is modular, the final shader becomes one optimized function.

Example:
```ts
float map(vec3 p)
{
float d0 = length(p)-1.0;
float d1 = sdf_box(p-vec3(2,0,0),vec3(1));
float d2 = min(d0,d1);

return d2;
}
```
No dynamic dispatch. Pure GLSL.

### 11. Huge Advantage: Procedural Worlds

Because the scene is data-driven, you can generate worlds.

Example:
```ts
for(let i=0;i<100;i++)
{
  scene.children.push({
    type:"sphere",
    params:{r:1, pos:[rand(),0,rand()]}
  });
}
```
The engine compiles it automatically.

### 12. Advanced Engines Add

#### Spatial repetition
```ts
p = mod(p,4.0)-2.0;
```
Infinite worlds.

#### SDF LOD

Simplify distant geometry.


#### Scene BVH

Accelerates large SDF scenes.


#### Hybrid rendering
```
SDF + triangle meshes
```
in same shader.


### 13. Full Modern Raymarch Pipeline

Serious raymarch engines use:
```
SDF Primitives
      │
      ▼
SDF Node Graph
      │
      ▼
Shader Code Generator
      │
      ▼
Module Resolver
      │
      ▼
Uber Shader
      │
      ▼
Feature Flags
      │
      ▼
Compiled GLSL
```


### 14. Result

This architecture lets you build:
```
huge procedural scenes
100+ primitives
complex materials
modular shader code
```
without giant unreadable shaders.

#### Fun fact:
Some advanced demoscene engines generate entire raymarched worlds from node graphs like this and compile them into a single 4KB shader.


---
# distance-field acceleration structures (BVH for SDFs), for faster raymarching


Raymarching becomes slow when the scene grows because the renderer evaluates the distance function everywhere. Large SDF scenes can require hundreds of distance evaluations per pixel. Modern SDF renderers speed this up using distance-field acceleration structures, similar to how triangle renderers use BVHs.

The most practical technique is an SDF BVH (Bounding Volume Hierarchy).


### 1. The Core Problem

Naive raymarch scene:
```ts
float map(vec3 p)
{
    float d1 = sdf_sphere(p);
    float d2 = sdf_box(p);
    float d3 = sdf_torus(p);

    return min(min(d1,d2),d3);
}
```
Even if the ray is near only one object, the shader evaluates all objects every step.

If you have:
```
100 objects
80 raymarch steps
```
You may evaluate:
```
8000 SDF calls per pixel
```
That kills performance.


### 2. Bounding Volumes

Each SDF object gets a cheap bounding shape.

Example:
```
Sphere
Box
Torus
```
Bounding spheres:
```
Sphere radius = 1
Box radius = 1.73
Torus radius = 2
```
Before evaluating the expensive SDF, test the bounding distance.

Example:
```ts
float dBound = length(p - center) - radius;

if (dBound > bestDist)
    skip object;
```
This avoids unnecessary SDF calls.


### 3. BVH Tree Structure

Instead of checking every object, group them hierarchically.

Example:
```
Scene
 ├── BVH Node
 │     ├── Sphere
 │     └── Box
 │
 └── BVH Node
       ├── Torus
       └── Cylinder
```
Each node has a bounding volume.


### 4. BVH Traversal in GLSL

Pseudo GLSL:
```ts
float map(vec3 p)
{
    float best = 1e9;

    float dNode1 = sdSphere(p - node1Center, node1Radius);
    if (dNode1 < best)
    {
        best = min(best, sdf_sphere(p));
        best = min(best, sdf_box(p));
    }

    float dNode2 = sdSphere(p - node2Center, node2Radius);
    if (dNode2 < best)
    {
        best = min(best, sdf_torus(p));
        best = min(best, sdf_cylinder(p));
    }

    return best;
}
```
If a node is far away, all children are skipped.


### 5. Performance Improvement

Without BVH:
```
objects = 100
steps = 80
evaluations = 8000
```
With BVH:
```
node tests ≈ 5
SDF tests ≈ 5–10
```
Total:
```
≈ 400 evaluations
```
Often 10–20× faster.


### 6. Distance Field Culling

Even better trick: distance field bounds.

If bounding volume returns distance:
```
dBound
```
and
```
dBound > bestDistance
```
we skip the subtree entirely.

This works perfectly with raymarching.



### 7. Automatic BVH Builder

The engine builds the BVH on CPU.

Example TypeScript:
```ts
type SDFObject = {
  center: [number,number,number]
  radius: number
}

function buildBVH(objects:SDFObject[])
{
  if(objects.length <= 2)
      return {objects};

  const mid = Math.floor(objects.length/2);

  return {
    left: buildBVH(objects.slice(0,mid)),
    right: buildBVH(objects.slice(mid))
  };
}
```
Then the BVH is compiled into GLSL code.


### 8. Generated GLSL Example

Auto-generated shader:
```ts
float map(vec3 p)
{
float best = 1e9;

float d0 = length(p - vec3(0,0,0)) - 5.0;
if(d0 < best)
{
    float d1 = length(p)-1.0;
    best = min(best,d1);

    float d2 = sdf_box(p-vec3(2,0,0),vec3(1));
    best = min(best,d2);
}

float d3 = length(p - vec3(10,0,0)) - 4.0;
if(d3 < best)
{
    float d4 = sdf_torus(p);
    best = min(best,d4);
}

return best;
}
```
Many expensive SDFs never run.


### 9. Extra Acceleration Tricks

Advanced raymarch engines combine BVH with:

#### Spatial repetition
```ts
p = mod(p,cell)-0.5*cell;
```
Infinite objects but evaluated once.


#### Distance caching

Reuse distance from previous step.


#### Adaptive step limits

Reduce iterations when far from geometry.


#### Multi-resolution SDF

Low-res SDF first, refine later.


### 10. Extreme Optimization Used in Demoscene

Some engines create:
```
Distance Mipmaps
```
or
```
Distance Clipmaps
```
Like voxel LOD but for SDFs.

This can make huge worlds raymarchable.


### 11. Hybrid Acceleration (Modern Technique)

Best raymarch engines mix:
```
BVH for objects
+
distance bounds
+
repetition
+
procedural SDF
```
Result:
```
large worlds
real-time performance
```


### 12. Final Architecture of a Serious Raymarch Engine
```
SDF primitives
      │
      ▼
SDF node graph
      │
      ▼
BVH builder
      │
      ▼
GLSL code generator
      │
      ▼
Uber shader system
      │
      ▼
GPU raymarcher
```

With this architecture you can render scenes with:
```
100–1000 SDF objects
complex materials
procedural terrain
```
while keeping the shader manageable.

# Ray Marching Optimization, Reducing March Steps: Distance Estimator Lipschitz bounds

 One of the biggest optimizations in serious raymarch renderers is using Lipschitz bounds for distance estimators. It directly reduces the number of raymarch steps — often 50–80% fewer steps — while staying safe (no surface overshoot).


### 1. The Raymarching Problem

Standard raymarching step:
```ts
t += map(p);
```
Where:
```ts
p = rayOrigin + rayDir * t
```
This assumes the distance function returns a perfect signed distance field.

But many functions aren’t perfect SDFs:
	
    •	fractals
	•	noise displacement
	•	smooth blends
	•	domain warps

When the SDF isn’t exact, the ray must take very small steps, increasing iteration count.


### 2. Lipschitz Constant

A function has a Lipschitz constant L if its gradient never exceeds that value:
```ts
|f(x1) - f(x2)| ≤ L |x1 - x2|
```
For raymarching this means:
```ts
safeStep = distance / L
```
If L > 1, the raw distance is too optimistic and may overshoot.


### 3. Correct Raymarch Step

Instead of:
```ts
t += dist;
```
Use:
```ts
t += dist / L;
```
Where:
```
L = Lipschitz constant
```

### 4. Example

Sphere SDF:
```ts
float sdSphere(vec3 p,float r)
{
    return length(p) - r;
}
```
For this primitive:
```ts
L = 1
```
So no change needed.


### 5. Domain Warping Case

Example warp:
```ts
p += sin(p*3.0)*0.2;
```
Now the function’s gradient can exceed 1.

Estimated Lipschitz constant:
```ts
L ≈ 1 + warpAmplitude * warpFrequency
```
Example:
```ts
L ≈ 1 + 0.2 * 3 = 1.6
```
Correct step:
```ts
t += dist / 1.6;
```
This avoids overshooting.


### 6. Fractal Distance Estimators

Fractals often produce distance estimators, not true SDFs.

Example Mandelbulb DE:
```ts
float de(vec3 p)
{
    vec3 z = p;
    float dr = 1.0;
    float r = 0.0;

    for(int i=0;i<8;i++)
    {
        r = length(z);
        if(r>2.0) break;

        float theta = acos(z.z/r);
        float phi = atan(z.y,z.x);

        dr = pow(r,7.0)*8.0*dr + 1.0;

        float zr = pow(r,8.0);
        theta *= 8.0;
        phi *= 8.0;

        z = zr*vec3(
            sin(theta)*cos(phi),
            sin(phi)*sin(theta),
            cos(theta)
        );

        z += p;
    }

    return 0.5*log(r)*r/dr;
}
```
This already encodes a Lipschitz-like bound via dr.

The returned value is safe to step.


### 7. Global Lipschitz Bounds

Sometimes you estimate one global constant:
```
Lscene
```
Then step:
```ts
t += dist / Lscene;
```
Example scene:
```
sphere
box
domain warp
```
Estimated bound:
```ts
Lscene = 2.0
```
This guarantees safety.


### 8. Local Lipschitz Bounds (Better)

Advanced renderers compute per-node bounds.

Example SDF node:
```
warp
  └ sphere
```
Warp Lipschitz:
```
Lwarp
```
Sphere Lipschitz:
```
1
```
Combined bound:
```
L = Lwarp
```
The ray step becomes:
```
t += dist / L;
```


### 9. Major Performance Impact

Typical raymarch:
```ts
steps ≈ 120
```
With Lipschitz correction:
```ts
steps ≈ 40–60
```
Huge speedup.

### 10. Combined With BVH

Best raymarch engines combine:
```
BVH acceleration
+
Lipschitz bounds
+
distance estimators
```
Result: very large SDF scenes running in real time.


### 11. Example Optimized Raymarch Loop
```ts
float raymarch(vec3 ro, vec3 rd)
{
    float t = 0.0;

    for(int i=0;i<MAX_STEPS;i++)
    {
        vec3 p = ro + rd*t;

        float dist = map(p);

        if(dist < SURF_DIST)
            return t;

        t += dist / LIPSCHITZ;

        if(t > MAX_DIST)
            break;
    }

    return -1.0;
}
```


### 12. Another Trick Used With This

Many advanced raymarch shaders use cone marching.

Instead of treating rays as infinitely thin:
```
ray radius increases with distance
```
This allows:
```
LOD SDF sampling
```
which further reduces steps.


### 13. Advanced Raymarch Stack Used in Serious Engines

Modern high-end raymarch pipelines often combine:
```
SDF primitives
      │
      ▼
node graph
      │
      ▼
BVH acceleration
      │
      ▼
Lipschitz step correction
      │
      ▼
cone marching
      │
      ▼
adaptive step limits
```
This makes huge procedural worlds feasible.

#### Fun fact:
The famous demoscene production “The Timeless” rendered an entire city with raymarching using similar optimizations.

---
# Improve Shading Quality: analytic SDF normals vs gradient estimation 
Most raymarch shaders compute normals using numerical gradients, but serious SDF renderers often switch to analytic normals whenever possible. This improves both performance and shading quality.

⸻

1. The Common Method (Finite Difference)

Most tutorials compute normals like this:

vec3 getNormal(vec3 p)
{
    float e = 0.001;

    vec2 h = vec2(e,0);

    return normalize(vec3(
        map(p + h.xyy) - map(p - h.xyy),
        map(p + h.yxy) - map(p - h.yxy),
        map(p + h.yyx) - map(p - h.yyx)
    ));
}

This estimates the gradient of the distance field.

Problem

Each normal requires 6 extra map() calls.

If a pixel uses:

80 raymarch steps
+ normal calculation

you might evaluate:

86 map() calls

For large scenes this becomes expensive.

⸻

2. Analytic SDF Normals

For many primitives, we can compute the normal directly from math.

Example sphere:

Distance:

float sdSphere(vec3 p, float r)
{
    return length(p) - r;
}

Normal:

vec3 n = normalize(p);

No extra SDF calls.

⸻

3. Box Example

Box SDF:

float sdBox(vec3 p, vec3 b)
{
    vec3 d = abs(p) - b;
    return length(max(d,0.0)) + min(max(d.x,max(d.y,d.z)),0.0);
}

Analytic normal:

vec3 normalBox(vec3 p, vec3 b)
{
    vec3 d = abs(p) - b;
    return normalize(sign(p) * step(max(d.yzx,d.zxy), d));
}

Still no extra map() calls.

⸻

4. Performance Impact

Finite difference:

6 map() calls

Analytic normal:

0 extra calls

Speed improvement can reach:

2×–5× faster shading

for complex scenes.

⸻

5. Hybrid Strategy (Used in Engines)

Real raymarch engines combine both methods.

analytic normals → primitives
gradient normals → procedural shapes

Example:

vec3 getNormal(vec3 p)
{
#ifdef ANALYTIC_NORMAL
    return primitiveNormal(p);
#else
    return gradientNormal(p);
#endif
}


⸻

6. Smooth CSG Operations

For smooth unions we still need gradient blending.

Example smooth union:

float opSmoothUnion(float a, float b, float k)
{
    float h = clamp(0.5 + 0.5*(b-a)/k,0.0,1.0);
    return mix(b,a,h) - k*h*(1.0-h);
}

Normal must blend as well.

Advanced method:

track both distance and gradient

Return struct:

struct SDF
{
    float dist;
    vec3 grad;
};

Then union:

SDF opUnion(SDF a, SDF b)
{
    return (a.dist < b.dist) ? a : b;
}

Now normals are exact gradients.

⸻

7. SDF Gradient Propagation

Primitive:

SDF sphere(vec3 p)
{
    SDF s;
    s.dist = length(p) - 1.0;
    s.grad = normalize(p);
    return s;
}

Union:

SDF unionOp(SDF a, SDF b)
{
    return (a.dist < b.dist) ? a : b;
}

No gradient sampling needed.

⸻

8. Advanced Renderer Trick

Track both:

distance
normal
material

Structure:

struct Hit
{
    float dist;
    vec3 normal;
    int material;
};

Raymarch returns a fully shaded surface.

⸻

9. Why This Matters

Finite difference normals have problems:

noisy lighting

especially on tiny features

banding artifacts

expensive evaluation

Analytic normals fix all three.

⸻

10. Optimized Normal Sampling

If analytic isn’t possible, use tetrahedral sampling instead of 6 samples.

Better method:

vec3 normal(vec3 p)
{
    float e = 0.001;

    vec2 k = vec2(1,-1);

    return normalize(
        k.xyy*map(p + k.xyy*e) +
        k.yyx*map(p + k.yyx*e) +
        k.yxy*map(p + k.yxy*e) +
        k.xxx*map(p + k.xxx*e)
    );
}

This uses:

4 samples instead of 6

Less noise and faster.

⸻

11. Best Practice for Serious Raymarch Engines

Use this hierarchy:

analytic normals (fastest)
      ↓
gradient propagation
      ↓
tetrahedral sampling
      ↓
6-sample finite difference

Only use the last option if necessary.

⸻

### 12. Final Modern Raymarch Stack

High-end raymarch renderers usually combine:
```
SDF primitives
      │
      ▼
scene graph
      │
      ▼
BVH acceleration
      │
      ▼
Lipschitz step control
      │
      ▼
analytic normals
      │
      ▼
PBR shading
```
This architecture allows real-time rendering of very complex procedural scenes.

⸻

If you’re experimenting with raymarching, the next huge improvement most people eventually discover is:

distance field soft shadows + cone tracing, which dramatically improves lighting realism while still being very fast.
