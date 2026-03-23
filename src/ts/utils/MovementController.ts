// MovementController.ts
import * as THREE from 'three';
import { quat, mat3, vec3 } from 'gl-matrix';



export class MovementController {
    
    public cameraMat3 = new THREE.Matrix3();  // Three.js Matrix3 for uniforms
    public camYPos : number = .05; // Camera Y position for uniform updates
    public camFOV: number = 60.0; // Camera Field of View;

    private readonly _camRot = mat3.create();     // reuse mat3
    private readonly _axisRight = vec3.create();  // reuse vectors
    private readonly _axisUp = vec3.create();
    private readonly _axisForward = vec3.create();
    private readonly _qPitch = quat.create();     // reuse quats
    private readonly _qYaw = quat.create();
    private readonly _qRoll = quat.create();
    private readonly cameraQuat = quat.create(); // identity

    private _idleTime = 0;

    public applyIdleMotion(deltaTime: number) {
        this._idleTime += deltaTime;

        // 1. Breathing (Up/Down) - ~0.25Hz (1 breath every 4s)
        const breath = Math.sin(this._idleTime * 1.5) * 0.0001;

        // 2. Head Drift (Wandering)
        const driftYaw = Math.cos(this._idleTime * 0.7) * 0.0001;
        // half of breathing pitch
        const driftPitch = Math.sin(this._idleTime * 0.4) * 0.00005;

        // 3. Natural Micro-Roll
        const microRoll = Math.sin(this._idleTime * 1.1) * 0.00008;

        // 4. Random Jitter (Muscle twitch)
        const jitter = (Math.random() - 0.5) * 0.00025;

        // Inject these into your update logic
        // You can pass these into your existing update() as deltas
        this.update(
            breath + driftPitch + jitter, // dPitch
            jitter* 1.21,//driftYaw,                     // dYaw
            jitter*1.03 //microRoll                     // dRoll
        );
    }

    public euler: { roll: number; pitch: number; yaw: number } = {
        roll: 0,
        pitch: 0,
        yaw: 0,
    };
    
    

  constructor() {
    // Initialize cameraQuat to identity
    quat.identity(this.cameraQuat);
    // Initialize cameraMat3 to identity
    this.cameraMat3.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }

  public update( dPitch: number, dYaw: number, dRoll: number ): { roll: number; pitch: number; yaw: number } {

        // Extract camera basis from quaternion → mat3
        mat3.fromQuat(this._camRot, this.cameraQuat);

        // Fill axis vectors from matrix (avoids vec3.fromValues allocations)
        vec3.set(this._axisRight,   this._camRot[0], this._camRot[1], this._camRot[2]);
        vec3.set(this._axisUp,      this._camRot[3], this._camRot[4], this._camRot[5]);
        vec3.set(this._axisForward, this._camRot[6], this._camRot[7], this._camRot[8]);

        this.euler.pitch+=dPitch;
        this.euler.roll+=dRoll;
        this.euler.yaw+=dYaw;

        // Build incremental rotations (in-place)
        quat.setAxisAngle(this._qPitch, this._axisRight,   dPitch);
        quat.setAxisAngle(this._qYaw,   this._axisUp,      dYaw);
        quat.setAxisAngle(this._qRoll,  this._axisForward, dRoll); 

        // Accumulate rotations in cameraQuat (reuse memory)
        quat.multiply(this.cameraQuat, this._qYaw, this.cameraQuat);
        quat.multiply(this.cameraQuat, this._qPitch, this.cameraQuat);
        quat.multiply(this.cameraQuat, this._qRoll, this.cameraQuat);
        quat.normalize(this.cameraQuat, this.cameraQuat);
 
    
        const [x, y, z, w] = this.cameraQuat;
     
        this.cameraMat3.set(
            1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w,     2*x*z + 2*y*w,
            2*x*y + 2*z*w,     1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w,
            2*x*z - 2*y*w,     2*y*z + 2*x*w,     1 - 2*x*x - 2*y*y
        );

        const pitch = this.angleToGroundPlane( { x: this._axisForward[0], y: this._axisForward[1], z: this._axisForward[2]} );

        const yaw = this.yawToForward( { x: this._axisForward[0], y: this._axisForward[1], z: this._axisForward[2]} );

        const roll = this.rollToUp( { x: this._axisRight[0], y: this._axisRight[1], z: this._axisRight[2]} );
    
        return {roll, pitch, yaw};
    }

    // Returns angle (in radians) between vector v and the ground plane (XZ plane)
    private angleToGroundPlane(v: {x: number, y: number, z: number}): number {
        // Normalize the vector
        const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (length === 0) return 0; // avoid division by zero

        const ny = v.y / length; // dot with plane normal (0,1,0)
        return Math.asin(ny)* (180. / Math.PI); // angle in deg
    }

    private yawToForward(v: {x: number, y: number, z: number}): number {
        // Project to ground (XZ) plane
        const px = v.x;
        const pz = v.z;

        // Handle zero-length projection
        if (px === 0 && pz === 0) return 0;

        // atan2 returns angle in radians
        return Math.atan2(px, pz)* (180. / Math.PI); // angle in deg
        }

        private rollToUp(v: {x: number, y: number, z: number}): number {
        // Project onto up axis
    
        const sign = (v.y >= 0) ? -1 : 1;
        const s = (v.x* v.x + v.z*v.z);

        // Handle zero-length projection
        //if (px === 0 && py === 0) return 0;

        // atan2 returns signed angle in radians
        return sign*Math.acos(s/ (s+ v.y*v.y))* (180. / Math.PI); // angle in deg
    }
}


// // Example usage:
// const fwd = new Vector3(0, 0, 1);
// const angleRad = angleToGroundPlane(fwd);
// const angleDeg = (angleRad * 180) / Math.PI;

// console.log("Angle to ground plane:", angleDeg, "degrees"); // 0 degrees