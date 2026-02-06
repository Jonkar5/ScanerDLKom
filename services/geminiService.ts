import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

// Clave API (en producción se usaría import.meta.env.VITE_GEMINI_API_KEY)
const API_KEY = "TU_API_KEY_AQUI";
const genAI = new GoogleGenerativeAI(API_KEY);

export interface OCRResponse {
  text: string;
  category: string;
  suggestedFileName: string;
  suggestedFolder: string;
  summary: string;
  isQuestionnaire: boolean;
}

export const analyzeDocument = async (base64Image: string): Promise<OCRResponse> => {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          text: { type: SchemaType.STRING },
          category: { type: SchemaType.STRING },
          suggestedFileName: { type: SchemaType.STRING },
          suggestedFolder: { type: SchemaType.STRING },
          summary: { type: SchemaType.STRING },
          isQuestionnaire: { type: SchemaType.BOOLEAN },
        },
        required: ["text", "category", "suggestedFileName", "suggestedFolder", "summary", "isQuestionnaire"],
      },
    },
  });

  const imageData = base64Image.split(',')[1];

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageData
        }
      },
      {
        text: "Analyze this document accurately. 1. Extract all text. 2. Identify the document type. 3. Suggest a professional filename (e.g., 2024-05-20_Invoice_Amazon_45eur). 4. Suggest a logical OneDrive folder path. 5. Provide a short summary. 6. Detect if it's a questionnaire/form to be filled (isQuestionnaire: true/false)."
      }
    ]);

    const responseText = result.response.text();
    return JSON.parse(responseText) as OCRResponse;
  } catch (error) {
    console.error("Gemini OCR failed:", error);
    return {
      text: "Error durante el análisis OCR. Por favor, verifica tu conexión o clave API.",
      category: "Desconocido",
      suggestedFileName: `Escaneo_${new Date().toLocaleDateString().replace(/\//g, '-')}`,
      suggestedFolder: "Escaneos",
      summary: "No se pudo analizar el documento.",
      isQuestionnaire: false
    };
  }
};
