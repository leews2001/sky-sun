
//: Safer queryselector with type assertion and error handling
export function getElement<T extends Element>(selector: string): T {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Missing element: ${selector}`);
    return el as T;
}