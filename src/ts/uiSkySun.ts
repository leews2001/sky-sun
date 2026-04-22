// AtmosphereUI.ts

import GUI from 'lil-gui';
import { GuiController } from './utils/GUIUtils';

import { MovementController } from './utils/MovementController';


 //: The AtmosphereUI class encapsulates the user interface for 
 //: controlling various atmospheric and camera settings in the sky and sun rendering application.

export class AtmosphereUI {
   
   
    private gui: GUI;
    private settings: any; 
    private movController: MovementController; 
    private guiCtrl : GuiController;

    //: Constructor initializes the UI with references to the GUI instance, settings object, and movement controller.
    constructor(
        gui: GUI,
        settings: any, 
        movController: MovementController, 
    ) {
        this.gui = gui;
        this.guiCtrl = new GuiController(this.gui);
        this.settings = settings; 
        this.movController = movController; 

    }

    //: This method initializes the UI by creating folders and controls for different categories of settings.
    public init(): void {

        this.xAddAtmostphereFolder();
        this.xAddSunEffectFolder();
        this.xAddLensEffectFolder();

        this.xAddCameraFolder();
        this.xAddPostProcessFolder();
        this.xAddToneMappingFolder();
        this.xAddDebugFolder();
    }

    //--- PRIVATE METHODS

    //: This method sets up the ATMOSPHERE folder and its controls
    private xAddAtmostphereFolder() {

        const atm = this.gui.addFolder('ATMOSPHERE');
        
        atm.add(this.settings, 'enableMultipleScattering').name(' ▪ m. scatter');

        //: The aerosol control is a slider that allows the user to adjust the aerosol density in the atmosphere, 
        //: which affects the scattering and overall appearance of the sky.
 
        this.guiCtrl.addControl(atm, this.settings, 'aerosol', {
            label: ' ▪ aerosol',
            min: 0.1,
            max: 30.0,
            step: 0.1,
            decimals: 1,
            listen: true
        });

        atm.add(this.settings, 'enableDust').name(' ▪ dust');

        //: The wind intensity control is a slider that adjusts the strength of the wind effect in the atmosphere,
 
        this.guiCtrl.addControl(atm, this.settings, 'windIntensity', {
            label: ' ▪ wind',
            min: 0.,
            max: 1.0,
            step: 0.02,
            decimals: 2,
            listen: false
        });

        return;
    }

    //: This method sets up the SUN EFFECT folder and its controls
    private xAddSunEffectFolder() {

        const sun = this.gui.addFolder('SUN EFFECT');

        sun.add(this.settings, 'enableRefract').name(' ▪ refract');
        sun.add(this.settings, 'enableHeatHaze').name(' ▪ heat haze');
        sun.add(this.settings, 'enableLimbDarken').name(' ▪ limb dark');

        //: The sun elevation control is a slider that allows the user to adjust the angle of the sun above the horizon, 
        //: which affects the lighting and color of the sky.

        this.guiCtrl.addControl(sun, this.settings, 'sunElevation', {
            label: ' ▪ elev (deg)',
            min: -20,
            max: 89.0,
            step: 0.1,
            decimals: 1,
            listen: true
        });
  
        return;
    }

    //: This method sets up the LENS EFFECT folder and its controls
    private xAddLensEffectFolder() {

        const lens = this.gui.addFolder('LENS EFFECT');

        lens.add(this.settings, 'enableFlare').name(' ▪ flare');
        lens.add(this.settings, 'enableLensDirt').name(' ▪ dirt');

        this.guiCtrl.addControl(lens, this.settings, 'lensDirtWeight', {
            label: ' ▪ dirt wgt.',
            min: 0,
            max: 2,
            step: 0.1,
            decimals: 1,
            listen: false
        });

        this.guiCtrl.addControl(lens, this.settings, 'lensDirtStep0', {
            label: ' ▪ dirt step0',
            min: 0,
            max: 1,
            step: 0.1,
            decimals: 1,
            listen: false
        });

        this.guiCtrl.addControl(lens, this.settings, 'lensDirtStep1', {
            label: ' ▪ dirt step1',
            min: 0,
            max: 5,
            step: 0.1,
            decimals: 1,
            listen: false
        });

        return;
    }

    private syncRotation(euler: { pitch: number, roll: number, yaw: number }) {

        this.settings.camPitch = euler.pitch;
        this.settings.camRoll = euler.roll;
        this.settings.camYaw = euler.yaw;

        this.settings._prevPitch = euler.pitch;
        this.settings._prevRoll = euler.roll;
        this.settings._prevYaw = euler.yaw;

        return;
    }

    //: This method sets up the CAMERA folder and its rotation sliders
    private xAddCameraFolder() {

        const cam = this.gui.addFolder('CAMERA');
        cam.add(this.settings, 'enablebreathing').name(' ▪ breathing');

        this.addRotationSlider(cam, 'camRoll', 'roll');
        this.addRotationSlider(cam, 'camPitch', 'pitch');
        this.addRotationSlider(cam, 'camYaw', 'yaw');

        this.guiCtrl.addControl(cam, this.settings, 'camFov', {
            label: ' ▪ fOV',
            min: 3,
            max: 170,
            step: 0.5,
            decimals: 1,
            listen: true,
            onChange: (val: number) => {
                this.movController.camFOV = val;
            }
        });

        this.guiCtrl.addControl(cam, this.settings, 'eyeAttitude', {
            label: ' ▪ altitude',
            min: 0.02,
            max: 80,
            step: 0.1,
            decimals: 2,
            listen: true,
            onChange: (val: number) => {
                this.movController.camYPos = val;
            }
        });
        return;
    }

    //: This method adds a rotation slider for camera control and sets up its onChange behavior
    private addRotationSlider(folder: any, prop: string, label: string) {

        this.guiCtrl.addControl(folder, this.settings, prop, {
            label: ` ▪ ${label}`,
            min: -180,
            max: 180,
            step: 0.1,
            decimals: 1,
            listen: true,
            onChange: (val: number) => {

                //: 1. Calculate the delta from the LAST KNOWN STATE (not the current slider value, 
                //: which may have wrapped around)
                const stateKey = `_prev${prop.replace('cam', '')}` as keyof typeof this.settings;
                
                let delta = val - (this.settings[stateKey] as number);

                //: 2. Handle the -180/180 wrap-around for the slider
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;

                //: 3. Convert delta to radians for the movement controller
                const rad = delta * Math.PI / 180;
                const euler = this.movController.update(
                    prop === 'camPitch' ? -rad : 0,
                    prop === 'camYaw' ? rad : 0,
                    prop === 'camRoll' ? rad : 0
                );
                this.syncRotation(euler); // Atomic update
            }
        });

        return;
    }

    //: This method sets up the POST-PROCESS folder and its controls
    private xAddPostProcessFolder() {
        const pp = this.gui.addFolder('POST-PROCESS');

        pp.add(this.settings, 'enableDither').name(' ▪ dither');
        pp.add(this.settings, 'enableGrain').name(' ▪ grain');

        this.guiCtrl.addControl(pp, this.settings, 'grainWeight', {
            label: ' ▪ grain wgt.',
            min: 0,
            max: 3,
            step: 0.1,
            decimals: 1,
            listen: false
        });

        return;
    }

    //: This method sets up the TONE MAPPING folder and its controls
    private xAddToneMappingFolder() {

        const tone= this.gui.addFolder('TONE MAPPING');
        tone.add(this.settings, 'enableACES').name(' ▪ aces');
        return;
    }

    //: This method sets up the DEBUG folder and its controls
    private xAddDebugFolder() {

        const debug = this.gui.addFolder('DEBUG');

        debug.add(this.settings, 'enableCheckerboard').name(' ▪ checkerboard');

        this.guiCtrl.addControl(debug, this.settings, 'checkerboardScale', {
            label: ' ▪ scale',
            min: 1.0,
            max: 200.0,
            step: 1,
            decimals: 0,
            listen: false
        });
 
        return;
    }
 
} // End of AtmosphereUI class