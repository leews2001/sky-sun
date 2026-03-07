/**
 * 
 * @param callback 
 */

export function setupKeyControls(callback: (keyValue: number) => void) {
    window.addEventListener('keydown', (event) => {
        switch (event.key) {
            case '1': callback(1); break;
            case '2': callback(2); break;
            case '3': callback(3); break;
            case '4': callback(4); break;
            case '5': callback(5); break;
            case '6': callback(6); break;
            default: callback(0);
        }
    });

    window.addEventListener('keyup', () => {
        callback(0);
    });
}