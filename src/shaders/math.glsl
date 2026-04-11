#define LARGE_NUMBER 1e20
#define EPSILON 1e-6


vec2 quadratic_solve(float a,float b,float c)
{
    float d=b*b-a*c;
#if 1
    return d>0.0?(-b+sqrt(d)*vec2(-1,+1))/a:vec2(+INF,-INF);
#else
    // Expected to be more accurate.
    if(!(d>0.0)) return vec2(+INF,-INF);
    float q=-b+(b<0.0?sqrt(d):-sqrt(d)),l=c/q,h=q/a; // NOT sign(b), in case b=0.
    return vec2(min(l,h),max(l,h));
#endif
}


float rayPerpendicularDistance(vec3 ro, vec3 rd,  float radius)
{
    float b = dot(ro, rd);
    if ( b >  0.) {
        return 999.;
    }

    float d2 = dot(ro, ro) - b*b;
    
    float distance_to_surface = sqrt(d2) - radius; 
    return distance_to_surface;
}

// https://www.scratchapixel.com/lessons/3d-basic-rendering/minimal-ray-tracer-rendering-simple-shapes/ray-plane-and-ray-disk-intersection
float PlaneIntersection(vec3 rayOrigin, vec3 rayDirection, vec3 planeOrigin, vec3 planeNormal, out vec3 normal) 
{ 
    float t = -1.0f;
    normal = planeNormal;
    float denom = dot(-planeNormal, rayDirection); 
    if (denom > EPSILON) { 
        vec3 rayToPlane = planeOrigin - rayOrigin; 
        return dot(rayToPlane, -planeNormal) / denom; 
    } 
 
    return t; 
} 

float SphereIntersection(
    in vec3 rayOrigin, 
    in vec3 rayDirection, 
    in vec3 sphereCenter, 
    in float sphereRadius, 
    out vec3 normal)
{
      vec3 eMinusC = rayOrigin - sphereCenter;
      float dDotD = dot(rayDirection, rayDirection);

      float discriminant = dot(rayDirection, (eMinusC)) * dot(rayDirection, (eMinusC))
         - dDotD * (dot(eMinusC, eMinusC) - sphereRadius * sphereRadius);

      if (discriminant < 0.0) 
         return -1.0;

      float firstIntersect = (dot(-rayDirection, eMinusC) - sqrt(discriminant))
             / dDotD;
      
      float t = firstIntersect;
    
      normal = normalize(rayOrigin + rayDirection * t - sphereCenter);
      return t;
}


/*
 * Returns the distance between ro and the first intersection with the sphere
 * or -1.0 if there is no intersection. The sphere's origin is (0,0,0).
 * -1.0 is also returned if the ray is pointing away from the sphere.
 */
float ray_sphere_intersection(vec3 ro, vec3 rd, float radius)
{
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius*radius;
    if (c > 0.0 && b > 0.0) return -1.0;
    float d = b*b - c;
    if (d < 0.0) return -1.0;
    if (d > b*b) return (-b+sqrt(d));
    return (-b-sqrt(d));
}



// It returns the distance t along the ray to where it hits a sphere centered at the origin. 
// If there’s no hit, it returns -1.0.
float rayIntersectSphere(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius*radius;


    if (c > 0.0f && b > 0.0) {
        // Early Exit: Ray Pointing Away
        //  c > 0 → ray origin is outside the sphere
        //  b > 0 → ray direction points away from sphere center
        return -1.0;
    }

    float discr = b*b - c;
    if (discr < 0.0) {
        // Discriminant Check: no real roots → ray misses sphere.
        return -1.0;
    }
    
    // Special case: inside sphere, use far discriminant
    if (discr > b*b) {
        // ro inside sphere, so return far hit → -b + sqrt(discr)
        return (-b + sqrt(discr));
    }

    // Near hit → -b - sqrt(discr)
    return -b - sqrt(discr);
}

/*
   Note:
    mat3 cameraMat = mat3(rightVector, upVector, viewVector);

    vec3 rightVector = normalize(uCameraMat[0]); // Right (X)
    vec3 upVector    = normalize(uCameraMat[1]); // Up (Y)
    vec3 viewVector  = normalize(uCameraMat[2]); // Forward (Z)
*/
vec3 projection_camera(
    in vec2 fragCoord, 
    in float cameraFov, 
    in mat3  cameraMat,       // Camera orientation matrix
    out float phi, out float theta)
{
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    vec3 ray_dir = vec3( uv.x, uv.y, 1.0 / tan(radians(cameraFov) * 0.5));
    ray_dir = normalize(ray_dir); 
    ray_dir = cameraMat* ray_dir;

    phi = atan(ray_dir.x, ray_dir.z);
    theta = asin(ray_dir.y);

    return ray_dir;
}
