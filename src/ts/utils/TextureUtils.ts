// utils/TextureUtils.ts

import * as THREE from 'three';
import { makeNoise3D } from 'open-simplex-noise';

export async function loadRGBA64DitherTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => { 
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        texture.flipY = true; // Ensure correct orientation
        resolve(texture);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

export async function load3DNoiseFromBin(url: string): Promise<THREE.Data3DTexture> {

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const fullData = new Uint8Array(buffer);

  const size = 32;
  const expectedLength = size * size * size; // 32768
  const offset = fullData.length - expectedLength; // usually 20 bytes

  if (offset < 0 || expectedLength + offset > fullData.length) {
    throw new Error(`Invalid grey.bin: not enough data`);
  }

  const data = fullData.subarray(offset, offset + expectedLength); // slice from the back

  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipMapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  return texture;
}

export function saveDataTextureAsPNG(texture: THREE.DataTexture, filename = 'noise.png') {
  const width = texture.image.width;
  const height = texture.image.height;
  const data = texture.image.data;

  if (!data) {
    throw new Error('Texture data is null');
  }

  // Create a canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');

  // Convert Uint8Array to ImageData
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(data);
  ctx.putImageData(imageData, 0, 0);

  // Export to PNG
  canvas.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}




export function generateRGBA2DNoiseTexture( size:number): THREE.DataTexture {

const noise3D = makeNoise3D(10); 
const data = new Uint8Array(size * size * 4);

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const z = Math.floor((x + y * size) / size); // simulate depth
    const n = noise3D(x / 32, y / 32, z / 32); // smooth coherent noise [-1,1]
    const n2 = noise3D(x / 32, y / 32, z / 32); // smooth coherent noise [-1,1]
    const v = Math.floor((n * 0.5 + 0.5) * 255);
    const v2 = Math.floor((n2 * 0.5 + 0.5) * 255);
    const i = (x + y * size) * 4;
    data[i + 0] = v; // red
    data[i + 1] = v2; // green or offset
    data[i + 2] = v; // blue
    data[i + 3] = 255;
  }
}

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    texture.flipY = true; // Ensure correct orientation 
  return texture;
}

export function generateRGBA256NoiseTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter; // Enables mipmapping
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    texture.flipY = true; // Ensure correct orientation 
  return texture;
}
 

export function generateRGBA1024DitherTexture(): THREE.DataTexture {
    const size = 1024;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.floor(Math.random() * 256);
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter; // Enables mipmapping
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    texture.flipY = true; // Ensure correct orientation
    return texture;
}

export function generate3DNoiseTexture(): THREE.Data3DTexture {
    const size = 32;
    const data = new Uint8Array(size * size * size);
    for (let i = 0; i < data.length; i++) {
    data[i] = Math.floor(Math.random() * 256);
    }

    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping; 
    texture.minFilter = THREE.LinearMipmapLinearFilter; // Enables mipmapping
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
}


// TextureUtils.ts
export function createFallbackTexture(): THREE.Texture {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
}