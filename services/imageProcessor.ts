import { Point } from '../types';

/**
 * Motor de Procesamiento de Imagen Avanzado DLKom Pro (Powered by OpenCV.js)
 * Optimizaciones CamScanner Parity v2.0
 */

const getCV = () => (window as any).cv;

/**
 * Ordena 4 puntos en orden: Top-Left, Top-Right, Bottom-Right, Bottom-Left
 */
const sortPoints = (points: Point[]): Point[] => {
    if (points.length !== 4) return points;

    // Método robusto: Suma y Diferencia
    const sortedBySum = [...points].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const sortedByDiff = [...points].sort((a, b) => (a.x - a.y) - (b.x - b.y));

    return [
        sortedBySum[0], // TL (min sum)
        sortedByDiff[sortedByDiff.length - 1], // TR (max diff x-y)
        sortedBySum[sortedBySum.length - 1], // BR (max sum)
        sortedByDiff[0] // BL (min diff x-y)
    ];
};

export const autoDetectEdges = (canvas: HTMLCanvasElement): Point[] => {
    const cv = getCV();
    if (!cv || !cv.Mat) return [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];

    try {
        let src = cv.imread(canvas);
        let gray = new cv.Mat();
        let blurred = new cv.Mat();
        let edged = new cv.Mat();

        // 1. Reducir ruido mucho más agresivamente para textiles/madera
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.bilateralFilter(gray, blurred, 9, 75, 75, cv.BORDER_DEFAULT);

        // 2. Canny con umbrales dinámicos (simplificado)
        cv.Canny(blurred, edged, 50, 150);

        // 3. Operación Morfológica: Cerrar huecos
        let M = cv.Mat.ones(5, 5, cv.CV_8U);
        cv.morphologyEx(edged, edged, cv.MORPH_CLOSE, M);

        // 4. Encontrar Contornos
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestPoints: Point[] | null = null;

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);

            // El documento debe ser al menos el 15% de la imagen capturada
            if (area > (canvas.width * canvas.height * 0.15)) {
                let peri = cv.arcLength(contour, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(contour, approx, 0.02 * peri, true);

                if (approx.rows === 4 && area > maxArea) {
                    maxArea = area;
                    let pts: Point[] = [];
                    for (let j = 0; j < 4; j++) {
                        pts.push({
                            x: (approx.data32S[j * 2] / canvas.width) * 100,
                            y: (approx.data32S[j * 2 + 1] / canvas.height) * 100
                        });
                    }
                    bestPoints = sortPoints(pts);
                }
                approx.delete();
            }
        }

        src.delete(); gray.delete(); blurred.delete(); edged.delete(); M.delete(); contours.delete(); hierarchy.delete();

        if (bestPoints) return bestPoints;
    } catch (e) {
        console.error("OpenCV AutoDetect Error:", e);
    }

    // Default 10% margin fallback
    return [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
};

export const applyPerspectiveTransform = (canvas: HTMLCanvasElement, points: Point[]): string => {
    const cv = getCV();
    if (!cv || !cv.Mat || points.length !== 4) return canvas.toDataURL('image/jpeg', 0.9);

    try {
        let src = cv.imread(canvas);
        const sorted = sortPoints(points);

        let srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            sorted[0].x * canvas.width / 100, sorted[0].y * canvas.height / 100,
            sorted[1].x * canvas.width / 100, sorted[1].y * canvas.height / 100,
            sorted[2].x * canvas.width / 100, sorted[2].y * canvas.height / 100,
            sorted[3].x * canvas.width / 100, sorted[3].y * canvas.height / 100
        ]);

        const widthA = Math.hypot(sorted[1].x - sorted[0].x, sorted[1].y - sorted[0].y) * canvas.width / 100;
        const widthB = Math.hypot(sorted[2].x - sorted[3].x, sorted[2].y - sorted[3].y) * canvas.width / 100;
        const maxWidth = Math.max(widthA, widthB);

        const heightA = Math.hypot(sorted[1].x - sorted[2].x, sorted[1].y - sorted[2].y) * canvas.height / 100;
        const heightB = Math.hypot(sorted[0].x - sorted[3].x, sorted[0].y - sorted[3].y) * canvas.height / 100;
        const maxHeight = Math.max(heightA, heightB);

        let dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0,
            maxWidth, 0,
            maxWidth, maxHeight,
            0, maxHeight
        ]);

        let M = cv.getPerspectiveTransform(srcPts, dstPts);
        let dst = new cv.Mat();
        cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

        const outCanvas = document.createElement('canvas');
        cv.imshow(outCanvas, dst);
        const dataUrl = outCanvas.toDataURL('image/jpeg', 0.95);

        src.delete(); dst.delete(); srcPts.delete(); dstPts.delete(); M.delete();
        return dataUrl;
    } catch (e) {
        console.error("Perspective Error:", e);
        return canvas.toDataURL('image/jpeg', 0.9);
    }
};

export const applyAdaptiveThreshold = (canvas: HTMLCanvasElement, config: { blockSize: number, offset: number }) => {
    const cv = getCV();
    if (!cv || !cv.Mat) return;

    try {
        let src = cv.imread(canvas);
        let gray = new cv.Mat();
        let dst = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        const bSize = config.blockSize % 2 === 0 ? config.blockSize + 1 : config.blockSize;
        cv.adaptiveThreshold(gray, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, bSize, config.offset);
        cv.imshow(canvas, dst);
        src.delete(); gray.delete(); dst.delete();
    } catch (e) {
        console.error("Threshold Error:", e);
    }
};

export const applyMagicColor = (canvas: HTMLCanvasElement) => {
    const cv = getCV();
    if (!cv || !cv.Mat) return;

    try {
        let src = cv.imread(canvas);
        let dst = new cv.Mat();

        // 1. Mejorar el contraste global mediante CLAHE (LAB Colorspace)
        cv.cvtColor(src, dst, cv.COLOR_RGBA2RGB);
        let lab = new cv.Mat();
        cv.cvtColor(dst, lab, cv.COLOR_RGB2Lab);
        let channels = new cv.MatVector();
        cv.split(lab, channels);
        let l = channels.get(0);
        let clahe = new cv.CLAHE(3.0, new cv.Size(8, 8));
        clahe.apply(l, l);
        cv.merge(channels, lab);
        cv.cvtColor(lab, dst, cv.COLOR_Lab2RGB);

        // 2. Blanqueado Inteligente por división de iluminación
        let gray = new cv.Mat();
        cv.cvtColor(dst, gray, cv.COLOR_RGB2GRAY);
        let blurred = new cv.Mat();
        // Blur muy grande para detectar el fondo
        cv.GaussianBlur(gray, blurred, new cv.Size(65, 65), 0);

        // Dividir: (Normal / Blurred) * 255 -> Blanquea el papel manteniendo texto
        let result = new cv.Mat();
        dst.convertTo(dst, cv.CV_32FC3);
        let blurredFloat = new cv.Mat();
        cv.cvtColor(blurred, blurredFloat, cv.COLOR_GRAY2RGB);
        blurredFloat.convertTo(blurredFloat, cv.CV_32FC3);

        cv.divide(dst, blurredFloat, result, 255);
        result.convertTo(dst, cv.CV_8UC3);

        // 3. Toque final: Aumentar contraste y brillo para "Look Digital"
        dst.convertTo(dst, -1, 1.25, -15);

        cv.imshow(canvas, dst);

        src.delete(); dst.delete(); lab.delete(); channels.delete(); l.delete(); clahe.delete();
        gray.delete(); blurred.delete(); result.delete(); blurredFloat.delete();
    } catch (e) {
        console.error("Magic Color 2.0 Error:", e);
    }
};
