import { jsPDF } from 'jspdf';
import { PageData } from '../types';

export const generatePDF = async (pages: PageData[], fileName: string): Promise<void> => {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'px',
    format: 'a4'
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (i > 0) pdf.addPage();

    // Añadir imagen principal
    pdf.addImage(page.processed, 'JPEG', 0, 0, pageWidth, pageHeight);

    // Añadir sellos y firmas
    if (page.processing.stamps) {
      for (const stamp of page.processing.stamps) {
        const x = (stamp.x / 100) * pageWidth;
        const y = (stamp.y / 100) * pageHeight;

        if (stamp.type === 'custom' && stamp.imageUrl) {
          // Para sellos de imagen personalizados
          const stampWidth = 80 * stamp.scale;
          const stampHeight = 80 * stamp.scale;
          pdf.addImage(stamp.imageUrl, 'PNG', x - (stampWidth / 2), y - (stampHeight / 2), stampWidth, stampHeight);
        } else {
          // Para sellos de texto (Pagado, Urgente, etc.)
          pdf.saveGraphicsState();
          pdf.setGState(new (pdf as any).GState({ opacity: 0.8 }));

          let color = [0, 0, 0];
          let text = '';

          if (stamp.type === 'paid') { color = [16, 185, 129]; text = 'PAGADO'; }
          else if (stamp.type === 'urgent') { color = [244, 63, 94]; text = 'URGENTE'; }
          else if (stamp.type === 'pending') { color = [245, 158, 11]; text = 'PENDIENTE'; }

          pdf.setTextColor(color[0], color[1], color[2]);
          pdf.setDrawColor(color[0], color[1], color[2]);
          pdf.setLineWidth(3);

          // Dibujar marco rotado
          const angle = -12;
          const fontSize = 16 * stamp.scale;
          pdf.setFontSize(fontSize);
          pdf.setFont("helvetica", "bold");

          // jsPDF rotation needs radian or transform matrix, let's keep it simple for now
          // jsPDF text rotation: pdf.text(text, x, y, { angle: angle })
          pdf.text(text, x, y, { angle: 12, align: 'center' });

          pdf.restoreGraphicsState();
        }
      }
    }
  }

  pdf.save(`${fileName}.pdf`);
};

export const simulateCloudUpload = async (folderPath: string, fileName: string): Promise<boolean> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log(`Uploaded ${fileName}.pdf to OneDrive: ${folderPath}`);
      resolve(true);
    }, 2500);
  });
};
