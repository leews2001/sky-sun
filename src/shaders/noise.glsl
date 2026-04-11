
// // NOISE functions
// float tri(in float x){return abs(fract(x)-.5);}
// vec3 tri3(in vec3 p){return vec3( tri(p.z+tri(p.y*1.)), tri(p.z+tri(p.x*1.)), tri(p.y+tri(p.x*1.)));}
                            
// float triNoise3d(in vec3 p, in float spd, in float time)
// {
//     float z=1.4;
// 	float rz = 0.;
//     vec3 bp = p;
// 	for (float i=0.; i<=7.; i++ )
// 	{
//         vec3 dg = tri3(bp*2.);
//         p += (dg+time*spd);

//         bp *= 1.8;
// 		z *= 1.5;
// 		p *= 1.2;
//         //p.xz*= m2;
        
//         //rz+= (tri(p.z+tri(p.x+tri(p.y))))/z;

//         rz+= (tri(p.x+tri(p.y+tri(p.z))))/z;

//         bp += 0.14;
// 	}
// 	return rz;
// }




// A simple, smooth 3D Value Noise
// float smoothNoise(vec3 p) {
 
//     vec3 i = floor(p);
//     vec3 f = fract(p);
//     f = f* f;
//     //f = f * f * (3.0 - 2.0 * f); // Hermite interpolation (removes "sand" look)

//     // Hash function to get random values at grid corners
//     #define hash(p) fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123)
    
//     float n000 = hash(i + vec3(0, 0, 0));
//     float n100 = hash(i + vec3(1, 0, 0));
//     float n010 = hash(i + vec3(0, 1, 0));
//     float n110 = hash(i + vec3(1, 1, 0));
//     float n001 = hash(i + vec3(0, 0, 1));
//     float n101 = hash(i + vec3(1, 0, 1));
//     float n011 = hash(i + vec3(0, 1, 1));
//     float n111 = hash(i + vec3(1, 1, 1));

//     return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
//                mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
// }

// float fbm(vec3 p) {
//     float value = 0.0;
//     float amplitude = 1.85;
//     float frequency = 1.73; // Base frequency
    
//     for (int i = 0; i < 3; i++) { // 3 octaves is usually enough for "detail"
//         value += amplitude * smoothNoise(p * frequency);
//         p *= 2.02;      // Increase frequency for the next octave
//         amplitude *= 0.5; // Decrease influence of finer ripples
//     }
//     return value;
// }


// camera shake: https://www.shadertoy.com/view/ddt3RM
// vec2 random2(float seed)
// {
//     float rand1 = fract(sin(seed) * 43758.5453123);
//     float rand2 = fract(cos(seed) * 23421.631235);
    
//     return vec2(rand1, rand2) * 2.0 - 1.0;
// }

// void mainImage( out vec4 fragColor, in vec2 fragCoord )
// {

//     float time = iTime * 16.0 + sin(iTime * 15.0) * 0.25;
//     vec2 pos_rnd_1 = random2(floor(time));
//          pos_rnd_1 = pow(pos_rnd_1, vec2(3.0));
//     vec2 pos_rnd_2 = random2(floor(time) + 1.0);
//          pos_rnd_2 = pow(pos_rnd_2, vec2(3.0));
//     vec2 pos_rnd = 0.25*mix(pos_rnd_1, pos_rnd_2, fract(time));



//     vec2 uv = fragCoord/iResolution.xy;
//     uv = (uv - 0.5) * 0.96 + 0.5;
    
//     vec2 uv1 = uv + pos_rnd * 0.005;
//     vec2 uv2 = uv + pos_rnd * 0.002;
//     vec2 uv3 = uv + pos_rnd * 0.004;

//     // Time varying pixel color
//     float r = texture(iChannel0, uv1).r;
//     float g = texture(iChannel0, uv2).g;
//     float b = texture(iChannel0, uv3).b;

//     vec3 col = vec3(r,g,b);

//     // Output to screen
//     fragColor = vec4(col ,1.0);
// }